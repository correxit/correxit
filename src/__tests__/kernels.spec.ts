import {
  cap,
  configure,
  drain,
  lease,
  retries,
  snapshot,
  timeout
} from '../correxit/kernels';

let serial = 0;

function spawn(
  overrides: Partial<{
    clone: () => any;
    hasPendingInput: boolean;
    isDisposed: boolean;
    info: Promise<any>;
    interrupt: () => Promise<void>;
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
    interrupt: jest.fn(() => Promise.resolve()),
    isDisposed: false,
    name: overrides.name || 'python3',
    requestKernelInfo: jest.fn(() => Promise.resolve()),
    restart: jest.fn(() => Promise.resolve()),
    shutdown: jest.fn(() => Promise.resolve()),
    spec: Promise.resolve({ display_name: 'Python 3' }),
    ...overrides
  };
}

function session(kernel = spawn(), overrides: Partial<any> = {}) {
  return {
    dispose: jest.fn(),
    isDisposed: false,
    kernel,
    shutdown: jest.fn(async () => {
      await kernel.shutdown();
    }),
    ...overrides
  };
}

function create(
  overrides: Partial<{
    name: string;
    path: string;
    sessionManager: any;
  }> = {}
) {
  const name = overrides.name ?? `python3-${serial++}`;
  const sessionManager =
    'sessionManager' in overrides
      ? overrides.sessionManager
      : { startNew: jest.fn(async () => session(spawn({ name }))) };
  return {
    context: {
      model: { defaultKernelName: name },
      path: overrides.path ?? 'workbook.ipynb',
      ready: Promise.resolve(),
      sessionContext: { sessionManager }
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

  it('uses the settings defaults', () => {
    expect(cap()).toBe(3);
    expect(retries()).toBe(2);
    expect(timeout()).toBe(60_000);
    expect(snapshot().concurrency).toBe(3);
  });

  describe('lease', () => {
    it('starts a new kernel when the pool is empty', async () => {
      const name = named();
      const mock = spawn({ name });
      const workbook = create({
        name,
        sessionManager: { startNew: jest.fn(async () => session(mock)) }
      });

      const result = await lease(workbook);
      expect(result).not.toBeNull();
      const [leased, release] = result!;
      expect(leased).toBe(mock);
      expect(typeof release).toBe('function');
    });

    it('starts kernels in the workbook directory', async () => {
      const name = named();
      const mock = spawn({ name });
      const sessionManager = { startNew: jest.fn(async () => session(mock)) };
      const workbook = create({
        name,
        path: 'correxit-corrector/slot-2/workbook.ipynb',
        sessionManager
      });
      const result = await lease(workbook);
      expect(result).not.toBeNull();

      const options = (sessionManager.startNew as jest.Mock).mock.calls[0][0];
      expect(options).toMatchObject({
        kernel: { name },
        type: 'notebook'
      });
      expect(options.path.startsWith('correxit-corrector/slot-2/')).toBe(true);
      expect(options.path.endsWith(options.name)).toBe(true);
      expect(options.name).not.toBe('workbook.ipynb');
    });

    it('uses unique private session names for concurrent leases', async () => {
      const name = named();
      const kernels = [spawn({ name }), spawn({ name }), spawn({ name })];
      let calls = 0;
      const sessionManager = {
        startNew: jest.fn(async () => session(kernels[calls++]))
      };
      const workbook = create({
        name,
        path: 'correxit-corrector/slot-2/workbook.ipynb',
        sessionManager
      });
      const leases = await Promise.all([
        lease(workbook),
        lease(workbook),
        lease(workbook)
      ]);
      const names = (sessionManager.startNew as jest.Mock).mock.calls.map(
        ([options]) => options.name
      );
      expect(new Set(names).size).toBe(3);
      expect(names).not.toContain('workbook.ipynb');
      await Promise.all(leases.map(result => result![1]()));
    });

    it('waits for kernel info before leasing a new kernel', async () => {
      const name = named();
      let leased: unknown = null;
      let resolve: (() => void) | null = null;
      let requested: (() => void) | null = null;
      const request = new Promise<void>(done => {
        requested = done;
      });
      const info = new Promise<void>(done => {
        resolve = done;
      });
      const mock = spawn({ name });
      Object.defineProperty(mock, 'info', {
        get: () => {
          requested?.();
          return info;
        }
      });
      const workbook = create({
        name,
        sessionManager: { startNew: jest.fn(async () => session(mock)) }
      });
      const leasing = lease(workbook);
      void leasing.then(result => {
        leased = result;
      });
      await request;
      expect(leased).toBeNull();
      expect(resolve).not.toBeNull();

      const done: () => void = resolve || (() => undefined);
      done();
      expect((await leasing)?.[0]).toBe(mock);
    });

    it('returns null when session manager is missing', async () => {
      const workbook = create({ sessionManager: null });
      const result = await lease(workbook);
      expect(result).toBeNull();
    });

    it('returns null when kernel name is empty', async () => {
      const workbook = {
        context: {
          model: { defaultKernelName: '' },
          ready: Promise.resolve(),
          sessionContext: { sessionManager: { startNew: jest.fn() } }
        }
      } as any;
      const result = await lease(workbook);
      expect(result).toBeNull();
    });

    it('returns null and disposes session when kernel info times out', async () => {
      const name = named();
      const mock = spawn({ name });
      let signal: (() => void) | null = null;
      const accessed = new Promise<void>(done => {
        signal = done;
      });
      Object.defineProperty(mock, 'info', {
        get: () => {
          signal?.();
          return new Promise(() => {
            /* never resolves */
          });
        }
      });
      const sess = session(mock);
      const workbook = create({
        name,
        sessionManager: { startNew: jest.fn(async () => sess) }
      });

      configure({ concurrency: 3, retries: 1, timeout: 1 });
      const leasing = lease(workbook);
      await accessed; // info getter fired: setTimeout is now registered
      jest.advanceTimersByTime(1000);
      const result = await leasing;

      expect(result).toBeNull();
      expect(sess.shutdown).toHaveBeenCalled();
    });

    it('returns null when startNew throws', async () => {
      const workbook = create({
        sessionManager: {
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
        sessionManager: { startNew: jest.fn(async () => session(mock)) }
      });
      const first = await lease(workbook);
      expect(first).not.toBeNull();

      const [, release] = first!;
      await release();

      const second = await lease(workbook);
      expect(second).not.toBeNull();
      expect(
        workbook.context.sessionContext.sessionManager.startNew
      ).toHaveBeenCalledTimes(1);
    });

    it('keeps cwd as part of the runtime key', async () => {
      const name = named();
      const first = spawn({ name });
      const second = spawn({ name });
      let calls = 0;
      const sessionManager = {
        startNew: jest.fn(async () => session(calls++ === 0 ? first : second))
      };
      const one = create({
        name,
        path: 'correxit-corrector/slot-1/workbook.ipynb',
        sessionManager
      });
      const two = create({
        name,
        path: 'correxit-corrector/slot-2/workbook.ipynb',
        sessionManager
      });

      const leased = await lease(one);
      await leased![1]();

      const shifted = await lease(two);
      expect(shifted).not.toBeNull();
      expect(shifted![0]).toBe(second);
      expect(sessionManager.startNew).toHaveBeenCalledTimes(2);

      const [firstCall, secondCall] = (
        sessionManager.startNew as jest.Mock
      ).mock.calls.map(([options]) => options);
      expect(firstCall.kernel).toEqual({ name });
      expect(secondCall.kernel).toEqual({ name });
      expect(firstCall.path.startsWith('correxit-corrector/slot-1/')).toBe(
        true
      );
      expect(secondCall.path.startsWith('correxit-corrector/slot-2/')).toBe(
        true
      );
    });

    it('restarts a kernel before re-pooling it', async () => {
      const name = named();
      const mock = spawn({ name });
      const workbook = create({
        name,
        sessionManager: { startNew: jest.fn(async () => session(mock)) }
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
        sessionManager: {
          startNew: jest.fn(async () =>
            session(calls++ === 0 ? failing : fresh)
          )
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
        sessionManager: {
          startNew: jest.fn(async () =>
            session(calls++ === 0 ? failing : fresh)
          )
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
        sessionManager: { startNew: jest.fn(async () => session(mock)) }
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
        workbook.context.sessionContext.sessionManager.startNew
      ).toHaveBeenCalledTimes(1);
    });

    it('evicts kernel after TTL expires', async () => {
      const name = named();
      const mock = spawn({ name });
      const workbook = create({
        name,
        sessionManager: { startNew: jest.fn(async () => session(mock)) }
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
        sessionManager: { startNew: jest.fn(async () => session(mock)) }
      });
      const leased = await lease(workbook);
      expect(leased).not.toBeNull();
      await leased![1]();
      expect(mock.shutdown).not.toHaveBeenCalled();
    });

    it('limits outstanding leases to the concurrency cap', async () => {
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
        sessionManager: {
          startNew: jest.fn(async () =>
            session(
              spawn({
                name,
                restart: () =>
                  new Promise<void>(done => {
                    resolve = done;
                  })
              })
            )
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
        sessionManager: {
          startNew: jest.fn(async () => session(calls++ === 0 ? stale : fresh))
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
        workbook.context.sessionContext.sessionManager.startNew
      ).toHaveBeenCalledTimes(2);
      expect(stale.shutdown).toHaveBeenCalled();
    });
  });
});
