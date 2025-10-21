import { ISecretsManager } from 'jupyter-secrets-manager';
import { Correxit, Rubric, Workbook } from '.';
import { text as textDialog } from './input';
import { keygen } from './security';

export namespace Unlocker {
  export interface IOptions {
    token: symbol;
    secretsManager?: ISecretsManager;
  }
}

export class Unlocker implements Correxit.IUnlocker {
  constructor(options: Unlocker.IOptions) {
    Private.setToken(options.token);
    this._secretsManager = options.secretsManager;
  }

  /**
   * Unlock a workbook using:
   * - the key, if provided as argument
   * - the secrets manager, if available and key exist
   * - the stored passphrase, if exist
   * - prompting for a passphrase
   */
  async unlock(
    workbook: Workbook,
    rubric: Rubric | null,
    key: string | null
  ): Promise<Rubric.Unlocked | null> {
    rubric = rubric ?? Workbook.open(workbook, true);
    if (!rubric?.locked) {
      return rubric;
    }

    // Try to get the stored key from secrets manager if the key is null.
    if (!key && this._secretsManager) {
      const secret = await this._secretsManager.get(
        Private.getToken(),
        Correxit.UNLOCK,
        rubric.id
      );
      key = secret?.value ?? null;
    }

    // Try to use the stored passphrase if key is null.
    if (!key) {
      const passphrase = Private.getPassphrase();
      key = passphrase ? await keygen(passphrase, rubric.id) : null;
    }

    return this._unlock(workbook, rubric, key);
  }

  /**
   * Store a passphrase in the secrets manager
   */
  async storeKey(rubricID: string, key: string): Promise<void> {
    if (this._secretsManager) {
      await this._secretsManager.set(
        Private.getToken(),
        Correxit.UNLOCK,
        rubricID,
        { namespace: Correxit.UNLOCK, id: rubricID, value: key }
      );
    }
  }

  /**
   * Prompt the user for a passphrase and generate the key.
   */
  private async _promptPassphrase(
    workbook: Workbook,
    rubric: Rubric,
  ): Promise<string | null> {
    const { path } = workbook.context;
    const passphrase = await textDialog({
      title: 'Enter passphrase to unlock',
      label: `Enter passphrase for ${path}`
    });

    // Cancelled by the user.
    if (!passphrase) {
      return null;
    }
    // Store the passphrase for future usage if user set one.
    Private.setPassphrase(passphrase);

    const key = await keygen(passphrase, rubric.id);
    return key;
  }

  /**
   * Unlock the rubric.
   * It will prompt the user for a passphrase is the key is not provided or incorrect.
   */
  private async _unlock(
    workbook: Workbook,
    rubric: Rubric,
    key: string | null,
  ): Promise<Rubric.Unlocked | null> {
    const keyProvided = !!key;
    // If the key is not provided, prompt the user.
    if (!key) {
      key = await this._promptPassphrase(workbook, rubric);
    }
    // Still no key, the user cancelled the prompt, return.
    if (!key) {
      return null;
    }

    try {
      const unlocked = await Workbook.unlock(workbook, key);
      // Store the key if it unlocked the workbook.
      this.storeKey(rubric.id, key);
      return unlocked;
    } catch (error) {
      // If the key was provided but was wrong, try again to unlock with a passphrase
      // from the user.
      if (keyProvided) {
        return this._unlock(workbook, rubric, null);
      }
      console.error('Failed to unlock workbook:', error);
      return null;
    }
  }

  private _secretsManager?: ISecretsManager;
}

/**
 * A Private namespace to handle the secrets.
 */
namespace Private {
  /**
   * The token to use with the secrets manager, setter and getter.
   */
  let secretsToken: symbol;
  export function setToken(value: symbol): void {
    secretsToken = value;
  }
  export function getToken(): symbol {
    return secretsToken;
  }

  /**
   * The last passphrase used in this context.
   */
  let passphrase: string | undefined;
  export function setPassphrase(value: string | undefined): void {
    passphrase = value;
  }
  export function getPassphrase(): string | undefined {
    return passphrase;
  }
}
