import { IRenderMime } from '@jupyterlab/rendermime';
import { ISecretsManager } from 'jupyter-secrets-manager';
import { Correxit, Rubric, Workbook } from '.';
import * as input from './input';
import * as security from './security';

export type Secrets = {
  manager: ISecretsManager;
  passphrases: Set<string>;
  pending: Promise<string | null> | null;
  token: symbol;
};

export namespace Unlocker {
  /**
   * Acquire credentials through the configured unlocker plugin without opening the rubric
   * or changing the workbook.
   */
  export async function request(
    workbook: Workbook,
    unlocker: Correxit.Unlocker,
    purpose: Correxit.Unlocker.Purpose,
    credentials?: Partial<Workbook.Credentials & { silent?: boolean }> | null
  ): Promise<{ secret: security.Secret | null } | null> {
    if (credentials?.key)
      return { secret: { key: credentials.key, passphrase: null } };
    if (credentials?.passphrase)
      return { secret: { key: null, passphrase: credentials.passphrase } };

    const identifier = (() => {
      try {
        return Workbook.identifier(workbook);
      } catch {
        return null;
      }
    })();
    const path = workbook.context.path;
    const silent = !!credentials?.silent;
    for await (const secret of unlocker.request({
      identifier,
      path,
      purpose,
      silent
    }))
      return { secret };
    return null;
  }

  /** Store a secret key associated with an id. */
  export async function store(id: string, key: string, secrets: Secrets) {
    const { manager, token } = secrets;
    const secret = { namespace: Correxit.UNLOCKER, id, value: key };
    await manager.set(token, Correxit.UNLOCKER, id, secret);
  }

  /**
   * Core unlock function that tries:
   * - the key, if already in the rubric
   * - the key, if provided in credentials
   * - the passphrase, if provided in credentials
   * - candidate secrets yielded by the configured Unlocker plugin
   *
   * Verifies and updates the workbook upon first successful unlock and saves
   * the working key via unlocker.store().
   */
  export async function unlock(
    workbook: Workbook,
    unlocker: Correxit.Unlocker,
    credentials?: Partial<Workbook.Credentials & { silent: boolean }> | null
  ): Promise<Rubric.Unlocked | null> {
    const rubric = Workbook.open(workbook, true);
    if (!rubric) return null;

    const { id } = rubric;
    if (rubric.key) {
      const unlocked = await Workbook.unlock(workbook, rubric.key);
      await unlocker.store(id, rubric.key);
      return unlocked;
    }

    const attempt = async (secret: security.Secret) => {
      const key = await security.derive(secret, id);
      let unlocked: Rubric.Unlocked;
      try {
        unlocked = await Workbook.unlock(workbook, key);
      } catch (error) {
        if (error instanceof Correxit.Error.Unlock) return null;
        throw error;
      }
      await unlocker.store(id, key);
      return unlocked;
    };

    const handle = Workbook.Credentials.normalize({
      ...credentials, path: workbook.context.path
    });
    const supplied = handle?.key
      ? { key: handle.key, passphrase: null }
      : handle?.passphrase
        ? { key: null, passphrase: handle.passphrase }
        : null;
    if (supplied) {
      const unlocked = await attempt(supplied);
      if (unlocked) return unlocked;
    }

    const identifier = (() => {
      try {
        return Workbook.identifier(workbook);
      } catch {
        return null;
      }
    })();
    const path = workbook.context.path;
    const silent = !!credentials?.silent;
    const stream = unlocker.request({
      identifier,
      path,
      purpose: 'unlock',
      silent
    });

    for await (const secret of stream) {
      if (secret) {
        const unlocked = await attempt(secret);
        if (unlocked) return unlocked;
      }
    }

    return null;
  }

  /**
   * Construct the default Unlocker plugin provider using the secrets manager
   * and interactive prompts.
   */
  export function provider(
    secrets: Secrets,
    trans: IRenderMime.TranslationBundle
  ): Correxit.Unlocker {
    return {
      store: (id: string, key: string) => store(id, key, secrets),
      request: async function* ({
        identifier,
        path,
        purpose,
        silent
      }: Correxit.Unlocker.Request): AsyncGenerator<security.Secret | null> {
        if (purpose === 'unlock') {
          if (identifier?.rubric) {
            const stored = await secrets.manager.get(
              secrets.token,
              Correxit.UNLOCKER,
              identifier.rubric
            );
            if (stored?.value) yield { key: stored.value, passphrase: null };
          }
          for (const passphrase of secrets.passphrases)
            yield { key: null, passphrase };
          if (silent) return;

          const pending = secrets.pending || prompt(path, trans);
          secrets.pending = pending;
          const passphrase = await pending;
          if (secrets.pending === pending) secrets.pending = null;
          if (passphrase) {
            secrets.passphrases.add(passphrase);
            yield { key: null, passphrase };
            // A successful unlock closes the stream before this point.
            throw new Correxit.Error.Unlock(trans.__('Incorrect passphrase'));
          }
          return;
        }

        if (silent) return;
        if (purpose === 'submit') {
          const revision = await input.submission(trans);
          if (revision === null) return;
          if (!revision) {
            yield null;
            return;
          }
        }

        const prompts = {
          create: {
            title: trans.__('Enter a passphrase'),
            label: trans.__('Enter a passphrase for this workbook')
          },
          submit: {
            title: trans.__('Set a submission passphrase'),
            label: trans.__('Enter a passphrase to seal your submission')
          },
          revise: {
            title: trans.__('Enter your submission passphrase'),
            label: trans.__('Enter the passphrase you used when submitting')
          },
          recover: {
            title: trans.__('Recover encrypted cells'),
            label: trans.__('Enter a passphrase to attempt decryption')
          }
        };

        const passphrase = await input.text(prompts[purpose]);
        if (passphrase) {
          yield { key: null, passphrase };
          return;
        }

        if (purpose === 'recover') {
          const accepted = await input.confirm({
            title: trans.__('Revert to notebook'),
            body: trans.__(
              'Encrypted cells were detected. Reset without recovering?'
            )
          });
          if (accepted) yield null;
        }
      }
    };
  }
}

/** Prompt the user for an unlock passphrase. */
function prompt(
  path: string,
  trans: IRenderMime.TranslationBundle
): Promise<string | null> {
  return input.text({
    title: trans.__('Enter passphrase to unlock'),
    label: trans.__('Enter passphrase for %1', path)
  });
}
