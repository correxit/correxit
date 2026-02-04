import { IRenderMime } from '@jupyterlab/rendermime';
import { ISecretsManager } from 'jupyter-secrets-manager';
import { Correxit, Rubric, Workbook } from '.';
import * as input from './input';
import * as security from './security';

export namespace Unlocker {
  export async function attempt(
    workbook: Workbook,
    key: string
  ): Promise<Rubric.Unlocked | null> {
    try {
      return await Workbook.unlock(workbook, key);
    } catch {
      return null;
    }
  }

  export async function store(
    id: string,
    key: string,
    secrets: { manager: ISecretsManager | null; token: symbol; }
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
   * - the secrets manager if available and if key exists
   * - the given passphrase if available
   * - a cached passphrase if available
   * - a user prompt to provide a passphrase
   */
  export async function unlock(
    workbook: Workbook,
    credentials: Partial<Workbook.Credentials> | null,
    secrets: {
      manager: ISecretsManager | null;
      passphrases: Set<string>;
      remember: (value: string) => void | Promise<void>;
      token: symbol;
    },
    trans: IRenderMime.TranslationBundle
  ): Promise<Rubric.Unlocked | null> {
    const rubric = Workbook.open(workbook, true);
    if (!rubric) {
      return null;
    }
    if (!rubric.locked) {
      const unlocked = await attempt(workbook, rubric.key);
      await store(rubric.id, rubric.key, secrets);
      return unlocked;
    }

    const { id } = rubric;
    const { manager, passphrases, remember, token } = secrets;
    const handle = Workbook.Credentials.normalize(credentials);
    let key: string | null = handle?.key || null;
    if (manager && token && !key) {
      key = (await manager.get(token, Correxit.UNLOCKER, id))?.value ?? null;
    }
    if (key || handle?.passphrase) {
      key ||= await security.keygen(handle!.passphrase!, id);

      const unlocked = await attempt(workbook, key);
      if (unlocked) {
        await store(id, key, secrets);
        return unlocked;
      }
    }
    for (const passphrase of passphrases) {
      const key = await security.keygen(passphrase, id);
      const unlocked = await attempt(workbook, key);
      if (unlocked) {
        await store(id, key, secrets);
        return unlocked;
      }
    }

    const input = await prompt(workbook, trans);
    if (!input) {
      return null;
    }
    key = await security.keygen(input, id);

    const unlocked = await attempt(workbook, key);
    if (unlocked) {
      await remember(input);
      await store(id, key, secrets);
    }
    return unlocked;
  }
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

