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

/**
 * The cap for the number of hot kernels in the pool.
 */
const HOT = 5;

/**
 * Time-to-live (TTL) for a five-second opportunistic kernel cache.
 */
const TTL = 5000;

const pool = new Map<string, Started[]>();

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
  const started = take(workbook.context.model.defaultKernelName);
  const kernel = lend(started) || await start(workbook);
  if (!kernel) {
    return null;
  }
  return async
    ? [kernel, () => recycle(kernel)]
    : [kernel, () => void recycle(kernel)];
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
  if (kernels.length >= HOT) {
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
    return;
  }
  dispose(kernel);
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
