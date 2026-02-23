import { Kernel } from '@jupyterlab/services';
import { Workbook } from '.';

/**
 * A kernel connection that is ready to execute and a release function that the
 * client should call after it is done with the kernel to release it back to an
 * active kernel pool.
 */
type Leased<ASYNC extends boolean = false> = [
  kernel: Kernel.IKernelConnection,
  release: ASYNC extends true ? () => Promise<void> : () => void
];

type Started = { kernel: Kernel.IKernelConnection; timeout: Timeout; };

type Timeout = ReturnType<typeof setTimeout>;

const pool = new Map<string, Started[]>();

/**
 * Kernel pool configuration.
 */
export type Config = { concurrency: number; retries: number; timeout: number };

let attempts = 1;
let workers = 3;
let lifespan = 60;

/**
 * Semaphore state: number of outstanding leases (running + restarting) and
 * the queue of resolvers waiting for a slot.
 */
let live = 0;
const waiters: Array<() => void> = [];

/**
 * Time-to-live (TTL) for opportunistic kernel caching.
 */
const TTL = 2500;

/**
 * @returns the current concurrency cap.
 */
export function cap(): number {
  return workers;
}

/**
 * Update the kernel pool configuration.
 */
export function configure({ concurrency, retries, timeout }: Config): void {
  attempts = Math.max(0, retries);
  lifespan = Math.max(0, timeout);
  workers = Math.max(1, concurrency);
  // Wake any blocked callers that can now proceed.
  while (live < workers && waiters.length) {
    waiters.shift()!();
  }
}

/**
 * @internal Resets all module state. For use in tests only.
 */
export function drain(): void {
  for (const kernels of pool.values()) {
    for (const { timeout, kernel } of kernels) {
      clearTimeout(timeout);
      dispose(kernel);
    }
  }
  pool.clear();
  live = 0;
  workers = 3;
  waiters.length = 0;
}

/**
 * @returns A promise that resolves to a leased kernel (i.e., a kernel and its
 * release function) or `null`.
 *
 * #### Notes
 * If no kernel is available, a new one is started. If no kernel can be started,
 * the returned promise resolves to `null`.
 *
 * Released kernels are recycled (restart-then-repool) or disposed on failure.
 *
 * By default, the returned release function is synchronous fire-and-forget.
 * Pass `{ async: true }` to receive an async release function that resolves
 * after recycle is complete.
 */
export async function lease(workbook: Workbook): Promise<Leased | null>;
export async function lease(
  workbook: Workbook,
  _: { async: false; }
): Promise<Leased | null>;
export async function lease(
  workbook: Workbook,
  _: { async: true; }
): Promise<Leased<true> | null>;
export async function lease(
  workbook: Workbook,
  { async }: { async?: boolean; } = {}
): Promise<Leased | Leased<true> | null> {
  await acquire();
  const started = take(workbook.context.model.defaultKernelName);
  const kernel = lend(started) || await start(workbook);
  if (!kernel) {
    relinquish();
    return null;
  }

  const release = async ? () => recycle(kernel) : () => void recycle(kernel);
  return [kernel, release] as Leased;
}

/**
 * @returns the current retry count for failed workbooks.
 */
export function retries(): number {
  return attempts;
}

/**
 * Acquires one semaphore slot, blocking until `live < workers`.
 */
async function acquire(): Promise<void> {
  while (live >= workers) {
    await new Promise<void>(resolve => waiters.push(resolve));
  }
  live++;
}

/**
 * Disposes a kernel by shutting it down and releasing its resources.
 */
function dispose(kernel: Kernel.IKernelConnection): void {
  if (kernel.isDisposed) {
    return;
  }
  kernel.shutdown().catch(() => {}).finally(() => kernel.dispose());
}

/**
 * Caches an idle kernel with TTL eviction when pool capacity allows.
 */
function keep(kernel: Kernel.IKernelConnection): void {
  const started = { kernel, timeout: setTimeout(() => remove(kernel), TTL) };
  const kernels = queue(kernel.name);
  if (kernels.length >= workers) {
    clearTimeout(started.timeout);
    dispose(kernel);
    return;
  }
  kernels.push(started);
}

/**
 * @returns a cached kernel connection when it is usable, or `null` otherwise.
 */
function lend(started: Started | null): Kernel.IKernelConnection | null {
  if (!started || started.kernel.isDisposed) {
    return null;
  }
  return started.kernel;
}

/**
 * @returns the idle-kernel queue for a kernel name, creating it if missing.
 */
function queue(name: string): Started[] {
  return pool.get(name) || pool.set(name, []).get(name)!;
}

/**
 * Restarts a kernel before returning it to the hot pool or disposing it.
 */
async function recycle(kernel: Kernel.IKernelConnection): Promise<void> {
  const restarted = await kernel.restart().then(() => true).catch(() => false);
  if (restarted) {
    keep(kernel);
  } else {
    dispose(kernel);
  }
  relinquish();
}

/**
 * Relinquishes one semaphore slot and wakes the next waiter, if any.
 */
function relinquish(): void {
  live--;
  waiters.shift()?.();
}

/**
 * Removes a kernel from its queue and disposes it.
 */
function remove(kernel: Kernel.IKernelConnection): void {
  const name = kernel.name;
  pool.set(name, queue(name).filter(started => kernel !== started.kernel));
  dispose(kernel);
}

/**
 * Starts a new kernel for the workbook and returns its connection.
 */
async function start(
  workbook: Workbook
): Promise<Kernel.IKernelConnection | null> {
  const { kernelManager } = workbook.context.sessionContext;
  const name = workbook.context.model.defaultKernelName;
  if (!kernelManager || !name) {
    console.warn('kernels start error, missing kernel manager or name');
    return null;
  }
  try {
    return await kernelManager.startNew({ name });
  } catch (error) {
    console.warn('start kernel error', error);
  }
  return null;
}

/**
 * Takes the most recently cached idle kernel for a kernel name.
 */
function take(name: string): Started | null {
  const started = queue(name).pop() || null;
  if (started) {
    clearTimeout(started.timeout);
  }
  return started;
}

/**
 * @returns the current grading timeout in milliseconds (0 = disabled).
 */
export function timeout(): number {
  return lifespan * 1000;
}
