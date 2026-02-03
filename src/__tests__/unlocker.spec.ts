declare const require: any;

jest.mock('../correxit/commands', () => ({ CommandIDs: {} }));
jest.mock('../correxit/icons', () => ({ Icons: {} }));
jest.mock('../correxit/input', () => ({ text: jest.fn() }));
jest.mock('../correxit/security', () => require('./mocks/security'));
jest.mock('../correxit/workbook', () => ({
  Workbook: { open: jest.fn(), unlock: jest.fn() }
}));

import { ISecretsManager } from 'jupyter-secrets-manager';
import { Correxit } from '../correxit';
import { text as mockTextDialog } from '../correxit/input';
import { Rubric } from '../correxit/rubric';
import { keygen } from '../correxit/security';
import { Unlocker } from '../correxit/unlocker';
import { Workbook } from '../correxit/workbook';

describe('Unlocker', () => {
  const rubricId = 'rubric-123';
  const mockPath = 'test-notebook.ipynb';
  const token = Symbol('test-token');

  let mockWorkbook: any;
  let mockRubricLocked: Rubric.Locked;
  let mockRubricUnlocked: Rubric.Unlocked;
  let mockSecretsManager: jest.Mocked<ISecretsManager>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup Data Objects
    mockWorkbook = {
      context: { path: mockPath }
    };

    mockRubricLocked = {
      ...Rubric.create(),
      id: rubricId,
      locked: true,
      key: null,
      secret: 'ENC[correct-key]:secret-content'
    } as unknown as Rubric.Locked;

    mockRubricUnlocked = {
      ...mockRubricLocked,
      locked: false,
      key: 'correct-key',
      secret: { cells: {} }
    } as unknown as Rubric.Unlocked;

    mockSecretsManager = {
      get: jest.fn(),
      set: jest.fn()
    } as any;

    // Default Behavior Mocks
    (Workbook.open as jest.Mock).mockReturnValue(mockRubricLocked);

    // Default unlock success
    (Workbook.unlock as jest.Mock).mockImplementation(async (wb, key) => {
      // Logic mirrors the security mock: check if key matches
      if (key === 'correct-key') return mockRubricUnlocked;
      throw new Error('Invalid key');
    });
  });

  // Helper Wrapper to simulate Plugin closure
  const callUnlock = (
    key: string | null = null,
    passphrases = new Set<string>(),
    remember = jest.fn()
  ) =>
    Unlocker.unlock(mockWorkbook, key, {
      manager: mockSecretsManager,
      passphrases,
      remember,
      token
    });

  describe('unlock()', () => {
    it('returns immediately if rubric is already unlocked', async () => {
      (Workbook.open as jest.Mock).mockReturnValue(mockRubricUnlocked);
      const result = await callUnlock();

      expect(result).toBe(mockRubricUnlocked);
      expect(Workbook.unlock).not.toHaveBeenCalled();
    });

    it('uses the provided key argument first and skips secrets manager', async () => {
      const result = await callUnlock('correct-key');

      expect(Workbook.unlock).toHaveBeenCalledWith(mockWorkbook, 'correct-key');
      expect(mockSecretsManager.get).not.toHaveBeenCalled();
      expect(result).toBe(mockRubricUnlocked);
    });

    it('falls back to SecretsManager if key is missing', async () => {
      mockSecretsManager.get.mockResolvedValue({
        namespace: Correxit.UNLOCKER,
        id: rubricId,
        value: 'correct-key'
      });

      const result = await callUnlock();

      expect(mockSecretsManager.get).toHaveBeenCalledWith(
        token,
        Correxit.UNLOCKER,
        rubricId
      );
      expect(Workbook.unlock).toHaveBeenCalledWith(mockWorkbook, 'correct-key');
      expect(result).toBe(mockRubricUnlocked);
    });

    it('uses cached passphrase if available', async () => {
      // Setup passphrase cache
      const cachedPass = 'cached-pass';
      const expectedKey = `KEY<cached-pass:${rubricId}>`;

      (Workbook.unlock as jest.Mock).mockImplementation(async (wb, key) => {
        if (key === expectedKey) return mockRubricUnlocked;
        throw new Error('Invalid');
      });

      const result = await callUnlock(null, new Set([cachedPass]));

      expect(keygen).toHaveBeenCalledWith(cachedPass, rubricId);
      expect(Workbook.unlock).toHaveBeenCalledWith(mockWorkbook, expectedKey);
      expect(result).toBe(mockRubricUnlocked);
    });

    it('prompts user if no key or cache available', async () => {
      mockSecretsManager.get.mockResolvedValue(undefined);
      (mockTextDialog as jest.Mock).mockResolvedValue('my-passphrase');

      const expectedKey = `KEY<my-passphrase:${rubricId}>`;

      (Workbook.unlock as jest.Mock).mockImplementation(async (wb, key) => {
        if (key === expectedKey) return mockRubricUnlocked;
        throw new Error('Invalid');
      });

      const result = await callUnlock();

      expect(mockTextDialog).toHaveBeenCalled();
      expect(keygen).toHaveBeenCalledWith('my-passphrase', rubricId);
      expect(Workbook.unlock).toHaveBeenCalledWith(mockWorkbook, expectedKey);
      expect(result).toBe(mockRubricUnlocked);
    });

    it('updates cache and stores key in SecretsManager after successful prompt', async () => {
      mockSecretsManager.get.mockResolvedValue(undefined);
      (mockTextDialog as jest.Mock).mockResolvedValue('user-pass');
      const remember = jest.fn();

      (Workbook.unlock as jest.Mock).mockResolvedValue(mockRubricUnlocked);

      await callUnlock(null, new Set(), remember);

      expect(remember).toHaveBeenCalledWith('user-pass');
      expect(mockSecretsManager.set).toHaveBeenCalledWith(
        token,
        Correxit.UNLOCKER,
        rubricId,
        expect.objectContaining({
          value: expect.stringContaining('KEY<user-pass')
        })
      );
    });

    it('retries with prompt if provided argument key is incorrect', async () => {
      // 1. Initial Call with bad key
      const badKey = 'wrong-key';

      // 2. Mock User Input for second try
      (mockTextDialog as jest.Mock).mockResolvedValue('user-pass');
      const expectedRecoveryKey = `KEY<user-pass:${rubricId}>`;

      (Workbook.unlock as jest.Mock).mockImplementation(async (wb, key) => {
        if (key === badKey) throw new Error('Bad key');
        if (key === expectedRecoveryKey) return mockRubricUnlocked;
        throw new Error('Unknown');
      });

      const result = await callUnlock(badKey);

      expect(Workbook.unlock).toHaveBeenCalledTimes(2);
      expect(Workbook.unlock).toHaveBeenNthCalledWith(1, mockWorkbook, badKey);
      expect(Workbook.unlock).toHaveBeenNthCalledWith(
        2,
        mockWorkbook,
        expectedRecoveryKey
      );
      expect(result).toBe(mockRubricUnlocked);
    });
  });
});
