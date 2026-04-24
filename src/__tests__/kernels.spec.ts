import { drain, lease } from '../correxit/kernels';

let serial = 0;

function spawn(
  overrides: Partial<{
    clone: () => any;
    hasPendingInput: boolean;
    isDisposed: boolean;
    info: Promise<any>;
    name: string;
    restart: () => Promise<void>;
    shutdown: () => Promise<void>;
    spec: Promise<any>;
  }> = {}
) {
  return {
    clone: jest.fn(function () {
      return this;
    }),
    dispose: jest.fn(),
    hasPendingInput: false,
    info: Promise.resolve({}),
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
  const kernelManager =
    'kernelManager' in overrides
      ? overrides.kernelManager
      : { startNew: jest.fn(async () => spawn({ name })) };
  return {
    context: {
      model: { defaultKernelName: name },
      ready: Promise.resolve(),
      sessionContext: { kernelManager }
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
      const workbook = {
        context: {
          model: { defaultKernelName: '' },
          ready: Promise.resolve(),
          sessionContext: { kernelManager: { startNew: jest.fn() } }
        }
      } as any;
      const result = await lease(workbook);
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

    it('reuses kernel when restart reports 201 created', async () => {
      const name = named();
      const response = { status: 201 };
      const fresh = spawn({ hasPendingInput: true, name });
      const mock = spawn({
        clone: jest.fn(() => fresh),
        name,
        restart: () => Promise.reject({ response })
      });
      const workbook = create({
        name,
        kernelManager: { startNew: jest.fn(async () => mock) }
      });

      const first = await lease(workbook);
      expect(first).not.toBeNull();
      await first![1]();

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(second![0]).toBe(fresh);
      expect(mock.clone).toHaveBeenCalledTimes(1);
      expect(mock.dispose).toHaveBeenCalledTimes(1);
      expect(mock.shutdown).not.toHaveBeenCalled();
      expect(fresh.hasPendingInput).toBe(false);
      expect(
        workbook.context.sessionContext.kernelManager.startNew
      ).toHaveBeenCalledTimes(1);
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

      const leased = await lease(workbook);
      expect(leased).not.toBeNull();
      await leased![1]();
      expect(mock.shutdown).not.toHaveBeenCalled();
    });

    it('limits outstanding leases to workers', async () => {
      const name = named();
      const workbook = create({ name });
      const first3 = [lease(workbook), lease(workbook), lease(workbook)];

      const fourth = lease(workbook);
      let resolved = false;
      void fourth.then(() => {
        resolved = true;
      });

      await Promise.all(first3);
      expect(resolved).toBe(false);

      await (await first3[0])![1]();
      await fourth;
      expect(resolved).toBe(true);
    });

    it('holds the slot while restart is in flight', async () => {
      const name = named();
      let resolve: (() => void) | null = null;
      const workbook = create({
        name,
        kernelManager: {
          startNew: jest.fn(async () =>
            spawn({
              name,
              restart: () =>
                new Promise<void>(done => {
                  resolve = done;
                })
            })
          )
        }
      });

      const first = await lease(workbook);
      expect(first).not.toBeNull();

      const release = first![1]();
      const second = lease(workbook);
      let freed = false;
      void second.then(() => {
        freed = true;
      });

      await Promise.resolve();
      expect(freed).toBe(false);

      expect(resolve).not.toBeNull();
      const done: () => void = resolve || (() => undefined);
      done();
      await release;
      await second;
      expect(freed).toBe(true);
    });

    it('does not re-pool a recycled kernel after drain', async () => {
      const name = named();
      let resolve: (() => void) | null = null;
      const stale = spawn({
        name,
        restart: () =>
          new Promise<void>(done => {
            resolve = done;
          })
      });
      const fresh = spawn({ name });
      let calls = 0;
      const workbook = create({
        name,
        kernelManager: {
          startNew: jest.fn(async () => (calls++ === 0 ? stale : fresh))
        }
      });

      const first = await lease(workbook);
      expect(first).not.toBeNull();

      const release = first![1]();
      drain();

      expect(resolve).not.toBeNull();
      const done: () => void = resolve || (() => undefined);
      done();
      await release;

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(second![0]).toBe(fresh);
      expect(
        workbook.context.sessionContext.kernelManager.startNew
      ).toHaveBeenCalledTimes(2);
      expect(stale.shutdown).toHaveBeenCalled();
    });
  });
});
