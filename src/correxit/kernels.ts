import { PathExt } from '@jupyterlab/coreutils';
import { Kernel } from '@jupyterlab/services';
import { Workbook } from '.';

/**
 * A kernel connection paired with a release function. Call `release` when
 * finished to return the kernel to the pool.
 */
type Leased = [
  kernel: Kernel.IKernelConnection,
  release: () => Promise<void>
];

/** A cached idle kernel and its eviction timer. */
type Idle = {
  identity: Identity;
  kernel: Kernel.IKernelConnection;
  order: number;
  timer: ReturnType<typeof setTimeout>;
};

/** The runtime context a leased kernel must satisfy. */
type Identity = {
  cwd: string;
  key: string;
  name: string;
};

/** Time-to-live for idle kernel caching (ms). */
const TTL = 5000;

const pool = new Map<string, Idle[]>();
const waiters: Array<() => void> = [];

let attempts = 1;
let cached = 0;
let epoch = 0;
let lifespan = 60;
let live = 0;
let order = 0;
let recycling = 0;
let workers = 3;

/** Kernel pool configuration. */
export type Config = { concurrency: number; retries: number; timeout: number };

/** @returns the current concurrency cap. */
export function cap(): number {
  return workers;
}

/** Updates pool configuration and wakes any newly-eligible waiters. */
export function configure({ concurrency, retries, timeout }: Config): void {
  attempts = Math.max(0, retries);
  lifespan = Math.max(0, timeout);
  workers = Math.max(1, concurrency);
  trim();
  while (live + recycling < workers && waiters.length) waiters.shift()!();
}

/** @internal Resets all module state for tests. */
export function drain(): void {
  epoch++;
  for (const entries of pool.values()) {
    for (const { timer, kernel } of entries) {
      clearTimeout(timer);
      void dispose(kernel);
    }
  }
  pool.clear();
  attempts = 1;
  cached = 0;
  lifespan = 60;
  live = 0;
  order = 0;
  recycling = 0;
  workers = 3;
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

  const identity = await identify(workbook);
  const kernel = revive(take(identity)) ?? await start(workbook, identity);
  if (!kernel) {
    relinquish();
    return null;
  }

  let released = false;
  const expire = () => {
    if (released) return;
    released = true;
    kernel.interrupt().catch(() => {});
    void dispose(kernel);
    if (mark === epoch) relinquish();
  };
  const deadline = lifespan > 0 ? setTimeout(expire, lifespan * 1000) : null;
  const reclaim = async () => {
    if (released) return;
    released = true;
    if (deadline) clearTimeout(deadline);
    await recycle(identity, kernel, mark);
  };
  return [kernel, reclaim];
}

/** @returns the configured retry count. */
export function retries(): number {
  return attempts;
}

/** @returns the lease deadline in milliseconds (0 = no deadline). */
export function timeout(): number {
  return lifespan * 1000;
}

/** Blocks until a slot opens, then claims it. */
async function acquire(): Promise<void> {
  while (live + recycling >= workers)
    await new Promise<void>(resolve => waiters.push(resolve));
  live++;
}

/** Shuts down and disposes a kernel. Idempotent. */
async function dispose(kernel: Kernel.IKernelConnection): Promise<void> {
  if (!kernel.isDisposed)
    return kernel.shutdown().catch(() => {}).finally(() => kernel.dispose());
}

/** Removes a kernel from the pool and disposes it (TTL callback). */
function evict(idle: Idle): void {
  remove(idle);
  void dispose(idle.kernel);
}

/** Caches an idle kernel with TTL eviction. Evicts oldest on overflow. */
function keep(identity: Identity, kernel: Kernel.IKernelConnection): void {
  const idle: Idle = {
    identity,
    kernel,
    order: order++,
    timer: setTimeout(() => evict(idle), TTL)
  };
  const entries = shelf(identity);
  entries.push(idle);
  cached++;
  trim();
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
    const response =
      error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number } }).response
        : null;
    if (response?.status !== 201) throw error;

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

/** Restarts a kernel and returns it to the pool, or disposes on failure. */
async function recycle(
  identity: Identity,
  kernel: Kernel.IKernelConnection,
  mark: number
): Promise<void> {
  if (mark !== epoch) return dispose(kernel);
  live--;
  recycling++;
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('restart timeout')), 10_000)
    );
    const fresh = await Promise.race([restart(kernel), timeout]);
    if (mark === epoch) keep(identity, fresh);
    else await dispose(fresh);
  } catch {
    await dispose(kernel);
  } finally {
    if (mark === epoch) {
      recycling--;
      waiters.shift()?.();
    }
  }
}

/** Frees one slot and wakes the next blocked caller. */
function relinquish(): void {
  live--;
  waiters.shift()?.();
}

/** @returns the kernel if it is still usable, or `null`. */
function revive(idle: Idle | null): Kernel.IKernelConnection | null {
  return idle && !idle.kernel.isDisposed ? idle.kernel : null;
}

/** @returns the runtime identity after waiting for the document model. */
async function identify(workbook: Workbook): Promise<Identity> {
  const { context } = workbook;
  await context.ready.catch(() => {});
  const name = context.model.defaultKernelName;
  const dirname = PathExt.dirname(context.path || '');
  const cwd = dirname === '.' ? '' : dirname;
  return { cwd, key: `${name}\0${cwd}`, name };
}

/** Removes an idle kernel from its shelf. */
function remove(idle: Idle): void {
  const { key } = idle.identity;
  const entries = pool.get(key);
  if (!entries) return;

  const remaining = entries.filter(entry => entry !== idle);
  cached -= entries.length - remaining.length;
  if (remaining.length) pool.set(key, remaining);
  else pool.delete(key);
}

/** @returns the idle-kernel list for `identity`, creating it on first access. */
function shelf(identity: Identity): Idle[] {
  let entries = pool.get(identity.key);
  if (!entries) pool.set(identity.key, entries = []);
  return entries;
}

/** Starts a new kernel for the workbook. */
async function start(
  workbook: Workbook,
  identity: Identity
): Promise<Kernel.IKernelConnection | null> {
  const { kernelManager } = workbook.context.sessionContext;
  const { cwd, name } = identity;
  if (!kernelManager || !name) {
    console.warn('kernels: missing kernel manager or name');
    return null;
  }
  try {
    // `path` is part of kernel creation even though the public type only
    // exposes `name`; this keeps cwd selection session- and language-agnostic.
    const options: Kernel.IKernelOptions & { path: string } = {
      name,
      path: cwd
    };
    const kernel = await kernelManager.startNew(options);
    await kernel.info;
    return kernel;
  } catch (error) {
    console.warn('kernels: start failed', error);
  }
  return null;
}

/** Pops the most recently cached kernel for `identity`. */
function take(identity: Identity): Idle | null {
  const entries = pool.get(identity.key);
  const idle = entries?.pop() ?? null;
  if (idle) clearTimeout(idle.timer);
  if (idle) cached--;
  if (entries && !entries.length) pool.delete(identity.key);
  return idle;
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
    void dispose(idle.kernel);
  }
}
