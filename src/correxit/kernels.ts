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
  kernel: Kernel.IKernelConnection;
  timer: ReturnType<typeof setTimeout>;
};

/** Time-to-live for idle kernel caching (ms). */
const TTL = 2500;

const pool = new Map<string, Idle[]>();
const waiters: Array<() => void> = [];

let attempts = 1;
let epoch = 0;
let lifespan = 60;
let live = 0;
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
  lifespan = 60;
  live = 0;
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

  const name = await settle(workbook);
  const kernel = revive(take(name)) ?? await start(workbook);
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
    await recycle(kernel, mark);
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
function evict(kernel: Kernel.IKernelConnection): void {
  const name = kernel.name;
  pool.set(name, shelf(name).filter(idle => idle.kernel !== kernel));
  void dispose(kernel);
}

/** Caches an idle kernel with TTL eviction. Evicts oldest on overflow. */
function keep(kernel: Kernel.IKernelConnection): void {
  const idle: Idle = { kernel, timer: setTimeout(() => evict(kernel), TTL) };
  const entries = shelf(kernel.name);
  if (entries.length >= workers) {
    const oldest = entries.shift()!;
    clearTimeout(oldest.timer);
    void dispose(oldest.kernel);
  }
  entries.push(idle);
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
    if (mark === epoch) keep(fresh);
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

/** @returns the default kernel name after waiting for the document model. */
async function settle(workbook: Workbook): Promise<string> {
  const { context } = workbook;
  await context.ready.catch(() => {});
  return context.model.defaultKernelName;
}

/** @returns the idle-kernel list for `name`, creating it on first access. */
function shelf(name: string): Idle[] {
  let entries = pool.get(name);
  if (!entries) pool.set(name, entries = []);
  return entries;
}

/** Starts a new kernel for the workbook. */
async function start(
  workbook: Workbook
): Promise<Kernel.IKernelConnection | null> {
  const { kernelManager } = workbook.context.sessionContext;
  const name = await settle(workbook);
  if (!kernelManager || !name) {
    console.warn('kernels: missing kernel manager or name');
    return null;
  }
  try {
    const kernel = await kernelManager.startNew({ name });
    await kernel.info;
    return kernel;
  } catch (error) {
    console.warn('kernels: start failed', error);
  }
  return null;
}

/** Pops the most recently cached kernel for `name`. */
function take(name: string): Idle | null {
  const idle = shelf(name).pop() ?? null;
  if (idle) clearTimeout(idle.timer);
  return idle;
}
