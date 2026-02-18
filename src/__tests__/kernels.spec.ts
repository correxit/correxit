import { lease } from '../correxit/kernels';

function spawn(
  overrides: Partial<{
    isDisposed: boolean;
    name: string;
    restart: () => Promise<void>;
    shutdown: () => Promise<void>;
    spec: Promise<any>;
  }> = {}
) {
  return {
    dispose: jest.fn(),
    isDisposed: false,
    name: overrides.name || 'python3',
    restart: jest.fn(() => Promise.resolve()),
    shutdown: jest.fn(() => Promise.resolve()),
    spec: Promise.resolve({ display_name: 'Python 3' }),
    ...overrides
  };
}

function create(
  overrides: Partial<{
    kernelManager: any;
    name: string;
  }> = {}
) {
  const name = overrides.name ?? 'python3';
  const manager =
    'kernelManager' in overrides
      ? overrides.kernelManager
      : { startNew: jest.fn(async () => spawn({ name })) };
  return {
    context: {
      model: { defaultKernelName: name },
      sessionContext: { kernelManager: manager }
    }
  } as any;
}

describe('kernels', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('lease', () => {
    it('starts a new kernel when the pool is empty', async () => {
      const mock = spawn();
      const workbook = create({
        kernelManager: { startNew: jest.fn(async () => mock) }
      });

      const result = await lease(workbook);
      expect(result).not.toBeNull();
      const [leased, release] = result!;
      expect(leased).toBe(mock);
      expect(typeof release).toBe('function');
    });

    it('returns null when kernel manager is missing', async () => {
      const workbook = create({ kernelManager: null });
      const result = await lease(workbook);
      expect(result).toBeNull();
    });

    it('returns null when kernel name is empty', async () => {
      const wb = {
        context: {
          model: { defaultKernelName: '' },
          sessionContext: { kernelManager: { startNew: jest.fn() } }
        }
      } as any;
      const result = await lease(wb);
      expect(result).toBeNull();
    });

    it('returns null when startNew throws', async () => {
      const workbook = create({
        kernelManager: {
          startNew: jest.fn(async () => {
            throw new Error('fail');
          })
        }
      });
      const result = await lease(workbook);
      expect(result).toBeNull();
    });

    it('reuses a clean kernel from the pool', async () => {
      const mock = spawn();
      const workbook = create({
        kernelManager: { startNew: jest.fn(async () => mock) }
      });

      // Lease and release to populate the pool.
      const first = await lease(workbook);
      expect(first).not.toBeNull();
      const [, release] = first!;
      release();

      // The released kernel is dirty, so it restarts. Lease again.
      const second = await lease(workbook);
      expect(second).not.toBeNull();
      // The kernel was restarted (not freshly started) so startNew was
      // called only once (for the first lease).
      expect(
        workbook.context.sessionContext.kernelManager.startNew
      ).toHaveBeenCalledTimes(1);
    });

    it('restarts a dirty kernel from the pool', async () => {
      const mock = spawn();
      const workbook = create({
        kernelManager: { startNew: jest.fn(async () => mock) }
      });
      const first = await lease(workbook);
      first![1]();

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(mock.restart).toHaveBeenCalled();
    });

    it('falls back to start when restart fails', async () => {
      const failing = spawn({
        restart: () => Promise.reject(new Error('restart failed'))
      });
      const fresh = spawn();
      let calls = 0;
      const workbook = create({
        kernelManager: {
          startNew: jest.fn(async () => (calls++ === 0 ? failing : fresh))
        }
      });

      const first = await lease(workbook);
      first![1](); // release → dirty

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(second![0]).toBe(fresh);
      expect(failing.shutdown).toHaveBeenCalled();
    });

    it('disposes kernel on restart failure', async () => {
      const failing = spawn({
        restart: () => Promise.reject(new Error('fail'))
      });
      const fresh = spawn();
      let calls = 0;
      const workbook = create({
        kernelManager: {
          startNew: jest.fn(async () => (calls++ === 0 ? failing : fresh))
        }
      });

      const first = await lease(workbook);
      first![1](); // release
      await lease(workbook);
      expect(failing.shutdown).toHaveBeenCalled();
    });

    it('evicts kernel after TTL expires', async () => {
      const mock = spawn();
      const workbook = create({
        kernelManager: { startNew: jest.fn(async () => mock) }
      });

      const first = await lease(workbook);
      first![1](); // release
      jest.advanceTimersByTime(5000);
      expect(mock.shutdown).toHaveBeenCalled();
    });

    it('skips shutdown for already disposed kernel', async () => {
      const mock = spawn({ isDisposed: true });
      const workbook = create({
        kernelManager: { startNew: jest.fn(async () => mock) }
      });

      const first = await lease(workbook);
      first![1](); // release
      jest.advanceTimersByTime(5000);
      expect(mock.shutdown).not.toHaveBeenCalled();
    });
  });
});
