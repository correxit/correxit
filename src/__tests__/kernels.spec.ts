import { drain, lease } from '../correxit/kernels';

let serial = 0;

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
  const name = overrides.name ?? `python3-${serial++}`;
  const manager =
    'kernelManager' in overrides
      ? overrides.kernelManager
      : { startNew: jest.fn(async () => spawn({ name })) };
  return {
    context: {
      model: { defaultKernelName: name },
      ready: Promise.resolve(),
      sessionContext: { kernelManager: manager }
    }
  } as any;
}

describe('kernels', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    drain();
  });
  afterEach(() => {
    warn.mockRestore();
    jest.useRealTimers();
  });
  const named = () => `python3-${serial++}`;

  describe('lease', () => {
    it('starts a new kernel when the pool is empty', async () => {
      const name = named();
      const mock = spawn({ name });
      const workbook = create({
        name,
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
          ready: Promise.resolve(),
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
      const name = named();
      const mock = spawn({ name });
      const workbook = create({
        name,
        kernelManager: { startNew: jest.fn(async () => mock) }
      });

      const first = await lease(workbook);
      expect(first).not.toBeNull();

      const [, release] = first!;
      await release();

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(
        workbook.context.sessionContext.kernelManager.startNew
      ).toHaveBeenCalledTimes(1);
    });

    it('restarts a kernel before re-pooling it', async () => {
      const name = named();
      const mock = spawn({ name });
      const workbook = create({
        name,
        kernelManager: { startNew: jest.fn(async () => mock) }
      });
      const first = await lease(workbook);
      await first![1]();

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(mock.restart).toHaveBeenCalledTimes(1);
    });

    it('falls back to start when restart fails', async () => {
      const name = named();
      const failing = spawn({
        name,
        restart: () => Promise.reject(new Error('restart failed'))
      });
      const fresh = spawn({ name });
      let calls = 0;
      const workbook = create({
        name,
        kernelManager: {
          startNew: jest.fn(async () => (calls++ === 0 ? failing : fresh))
        }
      });
      const first = await lease(workbook);
      await first![1]();

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(second![0]).toBe(fresh);
      expect(failing.shutdown).toHaveBeenCalled();
    });

    it('disposes kernel on restart failure', async () => {
      const name = named();
      const failing = spawn({
        name,
        restart: () => Promise.reject(new Error('fail'))
      });
      const fresh = spawn({ name });
      let calls = 0;
      const workbook = create({
        name,
        kernelManager: {
          startNew: jest.fn(async () => (calls++ === 0 ? failing : fresh))
        }
      });
      const first = await lease(workbook);
      await first![1]();
      await lease(workbook);
      expect(failing.shutdown).toHaveBeenCalled();
    });

    it('evicts kernel after TTL expires', async () => {
      const name = named();
      const mock = spawn({ name });
      const workbook = create({
        name,
        kernelManager: { startNew: jest.fn(async () => mock) }
      });
      const first = await lease(workbook);
      await first![1]();
      jest.advanceTimersByTime(5000);
      expect(mock.shutdown).toHaveBeenCalled();
    });

    it('skips shutdown for already disposed kernel', async () => {
      const name = named();
      const mock = spawn({ isDisposed: true, name });
      const workbook = create({
        name,
        kernelManager: { startNew: jest.fn(async () => mock) }
      });
      const first = await lease(workbook);
      await first![1]();
      jest.advanceTimersByTime(5000);
      expect(mock.shutdown).not.toHaveBeenCalled();
    });

    it('limits outstanding leases to workers', async () => {
      const name = named();
      const workbook = create({ name });
      // workers = 3 (drain default); acquire all three slots
      const first3 = [lease(workbook), lease(workbook), lease(workbook)];

      // 4th lease must wait
      const fourth = lease(workbook);
      let resolved = false;
      void fourth.then(() => {
        resolved = true;
      });

      await Promise.all(first3);
      expect(resolved).toBe(false);

      // Release one slot; fourth should now unblock
      await (await first3[0])![1]();
      await fourth;
      expect(resolved).toBe(true);
    });
  });
});
