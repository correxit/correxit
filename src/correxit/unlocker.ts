import { IRenderMime } from '@jupyterlab/rendermime';
import { ISecretsManager } from 'jupyter-secrets-manager';
import { Correxit, Rubric, Workbook } from '.';
import * as input from './input';
import * as security from './security';

type Secrets = {
  manager: ISecretsManager | null;
  passphrases: Set<string>;
  pending: Promise<string | null> | null;
  token: symbol | null;
};

export namespace Unlocker {
  export async function store(
    id: string,
    key: string,
    secrets: Secrets
  ) {
    const { manager, token } = secrets;
    if (manager && token) {
      const secret = { namespace: Correxit.UNLOCKER, id, value: key };
      await manager.set(token, Correxit.UNLOCKER, id, secret);
    }
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
    if (!rubric) {
      return null;
    }

    const { id } = rubric;
    if (rubric.key) {
      await store(id, rubric.key, secrets);
      return attempt(workbook, rubric.key);
    }

    const handle = Workbook.Credentials.normalize(credentials);
    const unlocked = await resolve(workbook, id, handle, secrets);
    if (unlocked || credentials?.silent) {
      return unlocked;
    }
    return inquire(workbook, id, secrets, trans);
  }
}

/** Yields candidate keys in priority order without user interaction. */
async function* candidates(
  id: string,
  handle: Workbook.Credentials | null,
  secrets: Secrets
): AsyncGenerator<string> {
  if (handle?.key) {
    yield handle.key;
  }

  const { manager, token } = secrets;
  if (manager && token) {
    const stored = await manager.get(token, Correxit.UNLOCKER, id);
    if (stored?.value) {
      yield stored.value;
    }
  }
  if (handle?.passphrase) {
    yield await security.keygen(handle.passphrase, id);
  }
  for (const passphrase of secrets.passphrases) {
    yield await security.keygen(passphrase, id);
  }
}

/** Iterates candidate keys, returning on first successful unlock. */
async function resolve(
  workbook: Workbook,
  id: string,
  handle: Workbook.Credentials | null,
  secrets: Secrets
): Promise<Rubric.Unlocked | null> {
  for await (const key of candidates(id, handle, secrets)) {
    const unlocked = await attempt(workbook, key);
    if (unlocked) {
      await Unlocker.store(id, key, secrets);
      return unlocked;
    }
  }
  return null;
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
  if (secrets.pending === pending) {
    secrets.pending = null;
  }
  if (!passphrase) {
    return null;
  }

  const key = await security.keygen(passphrase, id);
  const unlocked = await attempt(workbook, key);
  if (unlocked) {
    secrets.passphrases.add(passphrase);
    await Unlocker.store(id, key, secrets);
  }
  return unlocked;
}

async function attempt(
  workbook: Workbook,
  key: string
): Promise<Rubric.Unlocked | null> {
  return await Workbook.unlock(workbook, key).catch(error => {
    if (error === Correxit.STRUCTURAL_ERROR) {
      throw error;
    }
    return null;
  });
}

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

