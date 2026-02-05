declare const require: any;

jest.mock('../correxit/commands', () => ({ CommandIDs: {} }));
jest.mock('../correxit/icons', () => ({ Icons: {} }));
jest.mock('../correxit/input', () => ({ text: jest.fn() }));
jest.mock('../correxit/security', () => require('./mocks/security'));
jest.mock('../correxit/workbook', () => ({
  Workbook: {
    Credentials: {
      normalize: (credentials: Partial<Workbook.Credentials> | null) => {
        if (!credentials) {
          return null;
        }
        const {
          key = null,
          unlock = null,
          passphrase = null,
          path = 'mock'
        } = credentials;
        return {
          path,
          key,
          passphrase: key ? null : passphrase,
          unlock
        } as Workbook.Credentials;
      }
    },
    open: jest.fn(),
    unlock: jest.fn()
  }
}));

import { ISecretsManager } from 'jupyter-secrets-manager';
import { Correxit } from '../correxit';
import * as input from '../correxit/input';
import { Rubric } from '../correxit/rubric';
import * as security from '../correxit/security';
import { Unlocker } from '../correxit/unlocker';
import { Workbook } from '../correxit/workbook';
import { nullTranslator } from '@jupyterlab/translation';

describe('Unlocker', () => {
  const id = 'rubric-123';
  const path = 'test-notebook.ipynb';
  const token = Symbol('test-token');
  let workbook: any;
  let locked: Rubric.Locked;
  let unlocked: Rubric.Unlocked;
  let manager: jest.Mocked<ISecretsManager>;
  beforeEach(() => {
    jest.clearAllMocks();
    workbook = { context: { path } };
    locked = {
      ...Rubric.create(),
      id,
      locked: true,
      key: null,
      secret: 'ENC[correct-key]:secret-content'
    } as unknown as Rubric.Locked;
    unlocked = {
      ...locked,
      locked: false,
      key: 'correct-key',
      secret: { cells: {} }
    } as unknown as Rubric.Unlocked;
    manager = { get: jest.fn(), set: jest.fn() } as any;
    (Workbook.open as jest.Mock).mockReturnValue(locked);
    (Workbook.unlock as jest.Mock).mockImplementation(async (_, key) => {
      if (key === 'correct-key') return unlocked;
      throw new Error('Invalid key');
    });
  });

  const trans = nullTranslator.load('correxit');
  const unlock = (
    credentials: Partial<Workbook.Credentials> | null = null,
    passphrases = new Set<string>()
  ) =>
    Unlocker.unlock(
      workbook,
      credentials,
      { manager, passphrases, token },
      trans
    );

  describe('unlock()', () => {
    it('returns immediately if rubric is already unlocked', async () => {
      (Workbook.open as jest.Mock).mockReturnValue(unlocked);
      const result = await unlock();
      expect(result).toBe(unlocked);
      expect(Workbook.unlock).toHaveBeenCalledWith(workbook, unlocked.key);
    });

    it('uses the provided key first and skips secrets manager', async () => {
      const result = await unlock({ key: 'correct-key' });
      expect(Workbook.unlock).toHaveBeenCalledWith(workbook, 'correct-key');
      expect(manager.get).not.toHaveBeenCalled();
      expect(result).toBe(unlocked);
    });

    it('unlocks when a passphrase is provided as an argument', async () => {
      const passphrase = 'direct-pass';
      const expected = `KEY<${passphrase}:${id}>`;
      (Workbook.unlock as jest.Mock).mockImplementation(async (_wb, key) => {
        if (key === expected) return unlocked;
        throw new Error('Invalid key');
      });

      const result = await unlock({ passphrase });
      expect(manager.get).toHaveBeenCalledWith(token, Correxit.UNLOCKER, id);
      expect(security.keygen).toHaveBeenCalledWith(passphrase, id);
      expect(Workbook.unlock).toHaveBeenCalledWith(workbook, expected);
      expect(result).toBe(unlocked);
    });

    it('returns null if user cancels the passphrase prompt', async () => {
      manager.get.mockResolvedValue(undefined);
      (input.text as jest.Mock).mockResolvedValue(null);

      const result = await unlock();
      expect(result).toBeNull();
      expect(Workbook.unlock).not.toHaveBeenCalled();
    });

    it('falls back to SecretsManager if key is missing', async () => {
      manager.get.mockResolvedValue({
        id,
        namespace: Correxit.UNLOCKER,
        value: 'correct-key'
      });

      const result = await unlock();
      expect(manager.get).toHaveBeenCalledWith(token, Correxit.UNLOCKER, id);
      expect(Workbook.unlock).toHaveBeenCalledWith(workbook, 'correct-key');
      expect(result).toBe(unlocked);
    });

    it('uses cached passphrase if available', async () => {
      const cached = 'cached-pass';
      const expected = `KEY<cached-pass:${id}>`;
      (Workbook.unlock as jest.Mock).mockImplementation(async (wb, key) => {
        if (key === expected) return unlocked;
        throw new Error('Invalid');
      });

      const result = await unlock(null, new Set([cached]));
      expect(security.keygen).toHaveBeenCalledWith(cached, id);
      expect(Workbook.unlock).toHaveBeenCalledWith(workbook, expected);
      expect(result).toBe(unlocked);
    });

    it('prompts user if no key or cache is available', async () => {
      manager.get.mockResolvedValue(undefined);
      (input.text as jest.Mock).mockResolvedValue('my-passphrase');

      const expected = `KEY<my-passphrase:${id}>`;
      (Workbook.unlock as jest.Mock).mockImplementation(async (wb, key) => {
        if (key === expected) return unlocked;
        throw new Error('Invalid');
      });

      const result = await unlock();
      expect(input.text).toHaveBeenCalled();
      expect(security.keygen).toHaveBeenCalledWith('my-passphrase', id);
      expect(Workbook.unlock).toHaveBeenCalledWith(workbook, expected);
      expect(result).toBe(unlocked);
    });

    it('caches and stores key in secrets manager after prompt', async () => {
      manager.get.mockResolvedValue(undefined);
      (input.text as jest.Mock).mockResolvedValue('user-pass');
      (Workbook.unlock as jest.Mock).mockResolvedValue(unlocked);
      const passphrases = new Set<string>();
      await unlock(null, passphrases);
      expect(passphrases.has('user-pass')).toBe(true);
      expect(manager.set).toHaveBeenCalledWith(
        token,
        Correxit.UNLOCKER,
        id,
        expect.objectContaining({
          value: expect.stringContaining('KEY<user-pass')
        })
      );
    });

    it('retries with prompt if provided key is incorrect', async () => {
      const wrong = 'wrong-key';
      (input.text as jest.Mock).mockResolvedValue('user-pass');

      const expected = `KEY<user-pass:${id}>`;
      (Workbook.unlock as jest.Mock).mockImplementation(async (wb, key) => {
        if (key === wrong) throw new Error('Bad key');
        if (key === expected) return unlocked;
        throw new Error('Unknown');
      });

      const result = await unlock({ key: wrong });
      expect(Workbook.unlock).toHaveBeenCalledTimes(2);
      expect(Workbook.unlock).toHaveBeenNthCalledWith(1, workbook, wrong);
      expect(Workbook.unlock).toHaveBeenNthCalledWith(2, workbook, expected);
      expect(result).toBe(unlocked);
    });
  });
});
