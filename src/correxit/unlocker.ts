import { IRenderMime } from '@jupyterlab/rendermime';
import { ISecretsManager } from 'jupyter-secrets-manager';
import { Correxit, Rubric, Workbook } from '.';
import * as input from './input';
import * as security from './security';

type Secrets = {
  manager: ISecretsManager;
  passphrases: Set<string>;
  pending: Promise<string | null> | null;
  token: symbol;
};

export namespace Unlocker {
  export async function store(id: string, key: string, secrets: Secrets) {
    const { manager, token } = secrets;
    const secret = { namespace: Correxit.UNLOCKER, id, value: key };
    await manager.set(token, Correxit.UNLOCKER, id, secret);
  }

  /** Acquire credentials without opening the rubric or changing the workbook. */
  export async function request(
    workbook: Workbook,
    purpose: Correxit.Unlocker.Purpose,
    credentials: Partial<Workbook.Credentials> | null,
    trans: IRenderMime.TranslationBundle
  ): Promise<{ secret: security.Credentials | null } | null> {
    if (credentials?.key)
      return { secret: { key: credentials.key, passphrase: null } };
    if (credentials?.passphrase)
      return { secret: { key: null, passphrase: credentials.passphrase } };

    if (purpose === 'submit') {
      const revision = await input.submission(trans);
      if (revision === null) return null;
      if (!revision) return { secret: null };
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
    if (passphrase) return { secret: { key: null, passphrase } };
    if (purpose !== 'recover') return null;

    const accepted = await input.confirm({
      title: trans.__('Revert to notebook'),
      body: trans.__(
        'Encrypted cells were detected. Reset without recovering?'
      )
    });
    return accepted ? { secret: null } : null;
  }

  /**
   * Unlock a workbook trying, in order:
   * - the key, if provided as an argument
   * - the secrets manager, if available
   * - the given passphrase, if provided
   * - cached passphrases from previous successful unlocks
   * - a user prompt (deduplicated across concurrent calls)
   */
  export async function unlock(
    workbook: Workbook,
    credentials: Partial<Workbook.Credentials & { silent: boolean }> | null,
    secrets: Secrets,
    trans: IRenderMime.TranslationBundle
  ): Promise<Rubric.Unlocked | null> {
    const rubric = Workbook.open(workbook, true);
    if (!rubric) return null;

    const { id } = rubric;
    if (rubric.key) {
      await store(id, rubric.key, secrets);
      return attempt(workbook, rubric.key);
    }

    const handle = Workbook.Credentials.normalize(credentials);
    const unlocked = await resolve(workbook, id, handle, secrets);
    if (unlocked || credentials?.silent) return unlocked;
    return inquire(workbook, id, secrets, trans);
  }
}

/** Attempt to unlock a workbook with the given key. */
async function attempt(
  workbook: Workbook,
  key: string
): Promise<Rubric.Unlocked> {
  return Workbook.unlock(workbook, key);
}

/** Yields candidate keys in priority order without user interaction. */
async function* candidates(
  id: string,
  handle: Workbook.Credentials | null,
  secrets: Secrets
): AsyncGenerator<string> {
  if (handle?.key) yield handle.key;

  const { manager, token } = secrets;
  const stored = await manager.get(token, Correxit.UNLOCKER, id);
  if (stored?.value) yield stored.value;
  if (handle?.passphrase) yield await security.keygen(handle.passphrase, id);
  for (const passphrase of secrets.passphrases)
    yield await security.keygen(passphrase, id);
}

/**
 * Prompts the user for a passphrase (deduplicated across concurrent calls).
 * The in-flight `pending` promise is shared so parallel callers join the same
 * dialog; it is cleared as soon as the dialog settles regardless of outcome.
 */
async function inquire(
  workbook: Workbook,
  id: string,
  secrets: Secrets,
  trans: IRenderMime.TranslationBundle
): Promise<Rubric.Unlocked | null> {
  const pending = secrets.pending || prompt(workbook, trans);
  secrets.pending = pending;

  const passphrase = await pending;
  if (secrets.pending === pending) secrets.pending = null;
  if (!passphrase) return null;
  secrets.passphrases.add(passphrase);

  const key = await security.keygen(passphrase, id);
  const unlocked = await attempt(workbook, key);
  await Unlocker.store(id, key, secrets);
  return unlocked;
}

/** Prompt the user for a passphrase. */
async function prompt(
  workbook: Workbook,
  trans: IRenderMime.TranslationBundle
): Promise<string | null> {
  const { path } = workbook.context;
  return input.text({
    title: trans.__('Enter passphrase to unlock'),
    label: trans.__('Enter passphrase for %1', path)
  });
}

/** Iterates candidate keys, returning on first successful unlock. */
async function resolve(
  workbook: Workbook,
  id: string,
  handle: Workbook.Credentials | null,
  secrets: Secrets
): Promise<Rubric.Unlocked | null> {
  for await (const key of candidates(id, handle, secrets)) {
    try {
      const unlocked = await attempt(workbook, key);
      await Unlocker.store(id, key, secrets);
      return unlocked;
    } catch {
      continue;
    }
  }
  return null;
}
