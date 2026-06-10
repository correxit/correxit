import { PathExt } from '@jupyterlab/coreutils';
import { Kernel, Session } from '@jupyterlab/services';
import { UUID } from '@lumino/coreutils';
import { Workbook } from '.';

/**
 * A kernel connection paired with a release function. Call `release` when
 * finished to return the kernel to the pool.
 */
type Leased = [kernel: Kernel.IKernelConnection, release: () => Promise<void>];

/** A started session and the kernel it owns. */
type Started = {
  kernel: Kernel.IKernelConnection;
  runtime: Runtime;
  session: Session.ISessionConnection;
};

/** A cached idle kernel and its eviction timer. */
type Idle = Started & {
  order: number;
  timer: ReturnType<typeof setTimeout>;
};

/** The runtime context a leased kernel must satisfy. */
type Runtime = {
  cwd: string;
  key: string;
  name: string;
};

/** Time-to-live for idle kernel caching (ms). */
const TTL = 5000;

const pool = new Map<string, Idle[]>();
const waiters: Array<() => void> = [];

const defaults = { attempts: 1, lifespan: 60, workers: 3 };

let attempts = defaults.attempts;
let lifespan = defaults.lifespan;
let workers = defaults.workers;

let active = 0;
let cached = 0;
let epoch = 0;
let order = 0;
let recycling = 0;

/** Kernel pool configuration. */
export type Config = { concurrency: number; retries: number; timeout: number };

/** Updates pool configuration and wakes any newly-eligible waiters. */
export function configure({ concurrency, retries, timeout }: Config): void {
  attempts = Math.max(0, retries);
  lifespan = Math.max(0, timeout);
  workers = Math.max(1, concurrency);
  trim();
  while (busy() < workers && waiters.length) wake();
}

/** @returns the current concurrency cap. */
export function cap(): number {
  return workers;
}

/** @returns the configured retry count. */
export function retries(): number {
  return attempts;
}

/** @returns the lease deadline in milliseconds (0 = no deadline). */
export function timeout(): number {
  return lifespan * 1000;
}

/** @internal Resets all module state for tests. */
export function drain(): void {
  epoch++;
  for (const entries of pool.values()) {
    for (const { timer, session } of entries) {
      clearTimeout(timer);
      void dispose(session);
    }
  }
  pool.clear();
  active = 0;
  attempts = defaults.attempts;
  cached = 0;
  lifespan = defaults.lifespan;
  order = 0;
  recycling = 0;
  workers = defaults.workers;
  waiters.length = 0;
}

/**
 * Lease a kernel for a workbook. Returns `[kernel, release]` or `null`.
 *
 * Released kernels are restarted and returned to the pool; failed restarts
 * are disposed. When `timeout > 0`, a deadline reclaims zombie leases by
 * interrupting the kernel and freeing the semaphore slot.
 */
export async function lease(workbook: Workbook): Promise<Leased | null> {
  const mark = epoch;
  await acquire();

  const runtime = await locate(workbook);
  const idle = take(runtime);
  const ready = revive(idle);
  if (idle && !ready) void dispose(idle.session);

  const started = ready ?? (await start(workbook, runtime));
  if (!started) {
    relinquish();
    return null;
  }

  const { kernel } = started;
  let released = false;
  const expire = () => {
    if (released) return;
    released = true;
    kernel.interrupt().catch(() => {});
    void dispose(started.session);
    if (mark === epoch) relinquish();
  };
  const deadline = lifespan > 0 ? setTimeout(expire, lifespan * 1000) : null;
  const release = async () => {
    if (released) return;
    released = true;
    if (deadline) clearTimeout(deadline);
    await recycle(started, mark);
  };
  return [kernel, release];
}

/** Blocks until a slot opens, then claims it. */
async function acquire(): Promise<void> {
  while (busy() >= workers)
    await new Promise<void>(resolve => waiters.push(resolve));
  active++;
}

/** @returns kernels that currently occupy the concurrency cap. */
function busy(): number {
  return active + recycling;
}

/** @returns the runtime after waiting for the document model. */
async function locate(workbook: Workbook): Promise<Runtime> {
  const { context } = workbook;
  await context.ready.catch(() => {});
  const name = context.model.defaultKernelName;
  const dirname = PathExt.dirname(context.path || '');
  const cwd = dirname === '.' ? '' : dirname;
  return { cwd, key: `${name}\0${cwd}`, name };
}

/** Pops the most recently cached kernel for `runtime`. */
function take(runtime: Runtime): Idle | null {
  const entries = pool.get(runtime.key);
  const idle = entries?.pop() ?? null;
  if (idle) clearTimeout(idle.timer);
  if (idle) cached--;
  if (entries && !entries.length) pool.delete(runtime.key);
  return idle;
}

/** @returns the lease if it is still usable, or `null`. */
function revive(idle: Idle | null): Started | null {
  return idle && !idle.kernel.isDisposed && !idle.session.isDisposed
    ? idle
    : null;
}

/** Starts a new kernel for the workbook. */
async function start(
  workbook: Workbook,
  runtime: Runtime
): Promise<Started | null> {
  const { sessionManager } = workbook.context.sessionContext;
  const { cwd, name } = runtime;
  if (!sessionManager || !name) {
    console.warn('kernels: missing session manager or kernel name');
    return null;
  }
  try {
    const path = PathExt.join(cwd, UUID.uuid4());
    const session = await sessionManager.startNew({
      kernel: { name },
      name: PathExt.basename(workbook.context.path) || path,
      path,
      type: 'notebook'
    });
    const { kernel } = session;
    if (!kernel) {
      await dispose(session);
      console.warn('kernels: missing kernel after session start');
      return null;
    }
    await kernel.info;
    return { kernel, runtime, session };
  } catch (error) {
    console.warn('kernels: start failed', error);
  }
  return null;
}

/** Frees one slot and wakes the next blocked caller. */
function relinquish(): void {
  active--;
  wake();
}

/** Restarts a kernel and returns it to the pool, or disposes on failure. */
async function recycle(started: Started, mark: number): Promise<void> {
  if (mark !== epoch) return dispose(started.session);
  active--;
  recycling++;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('restart timeout')), 10_000)
    );
    const kernel = await Promise.race([restart(started.kernel), timeout]);
    if (mark === epoch) keep({ ...started, kernel });
    else await dispose(started.session);
  } catch {
    await dispose(started.session);
  } finally {
    if (mark === epoch) {
      recycling--;
      wake();
    }
  }
}

/** Restarts a kernel, tolerating servers that return `201 Created`. */
async function restart(
  kernel: Kernel.IKernelConnection
): Promise<Kernel.IKernelConnection> {
  try {
    await kernel.restart();
    await kernel.requestKernelInfo();
    return kernel;
  } catch (error) {
    if (status(error) !== 201) throw error;

    const fresh = kernel.clone();
    // Dispose only the stale client connection. The restarted kernel lives on.
    kernel.dispose();
    try {
      await fresh.requestKernelInfo();
      fresh.hasPendingInput = false;
      return fresh;
    } catch (error) {
      fresh.dispose();
      throw error;
    }
  }
}

/** @returns an HTTP status carried by a Jupyter services error. */
function status(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('response' in error))
    return null;
  return (error as { response?: { status?: number } }).response?.status ?? null;
}

/** Caches an idle kernel with TTL eviction. Evicts oldest on overflow. */
function keep(started: Started): void {
  const idle: Idle = {
    ...started,
    order: order++,
    timer: setTimeout(() => evict(idle), TTL)
  };
  const entries = shelf(started.runtime);
  entries.push(idle);
  cached++;
  trim();
}

/** @returns the idle-kernel list for `runtime`, creating it on first access. */
function shelf(runtime: Runtime): Idle[] {
  let entries = pool.get(runtime.key);
  if (!entries) pool.set(runtime.key, entries = []);
  return entries;
}

/** Keeps total idle kernels bounded as cwd values change over time. */
function trim(): void {
  if (cached <= workers) return;

  const excess = [...pool.values()]
    .flat()
    .sort((left, right) => left.order - right.order)
    .slice(0, cached - workers);
  for (const idle of excess) {
    clearTimeout(idle.timer);
    remove(idle);
    void dispose(idle.session);
  }
}

/** Removes a kernel from the pool and disposes it (TTL callback). */
function evict(idle: Idle): void {
  remove(idle);
  void dispose(idle.session);
}

/** Removes an idle kernel from its shelf. */
function remove(idle: Idle): void {
  const { key } = idle.runtime;
  const entries = pool.get(key);
  if (!entries) return;

  const remaining = entries.filter(entry => entry !== idle);
  cached -= entries.length - remaining.length;
  if (remaining.length) pool.set(key, remaining);
  else pool.delete(key);
}

/** Shuts down and disposes a session and its kernel. Idempotent. */
async function dispose(session: Session.ISessionConnection): Promise<void> {
  if (!session.isDisposed)
    return session.shutdown().catch(() => {}).finally(() => session.dispose());
}

/** Wakes the next caller blocked on a pool slot. */
function wake(): void {
  waiters.shift()?.();
}
