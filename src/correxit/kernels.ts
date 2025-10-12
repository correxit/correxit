import { Kernel } from '@jupyterlab/services';
import { Workbook } from '.';

/**
 * A kernel connection that is ready to execute and a release function that the
 * client should call after it is done with the kernel to release it back to an
 * active kernel pool.
 */
type Leased = [Kernel.IKernelConnection, () => void];

type Started = {
  kernel: Kernel.IKernelConnection;
  ready: boolean;
  timeout: ReturnType<typeof setTimeout>;
};

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
 * the returned promise resolves to `null`. If a kernel available but it is not
 * ready, it is restarted.
 */
export const lease = (workbook: Workbook): Promise<Leased | null> => {
  const started = queue(workbook.context.model.defaultKernelName).pop();
  const leased = started && (lend(started) || restart(started));
  return (async potential => await potential || start(workbook))(leased);
};

function dispose(kernel: Kernel.IKernelConnection): void {
  if (kernel.isDisposed) {
    return;
  }
  kernel.shutdown().catch(() => {}).finally(() => kernel.dispose());
}

function lend({ kernel, ready }: Omit<Started, 'timeout'>): Leased | null {
  return ready ? [kernel, () => release(kernel)] : null;
}

function queue(name: string): Started[] {
  return pool.get(name) || pool.set(name, []).get(name)!
}

function release(kernel: Kernel.IKernelConnection): void {
  const timeout = setTimeout(() => remove(kernel), TTL);
  queue(kernel.name).push({ kernel, ready: false, timeout });
}

function remove(kernel: Kernel.IKernelConnection): void {
  const name = kernel.name;
  pool.set(name, queue(name).filter(started => kernel !== started.kernel));
  dispose(kernel);
}

async function restart({ kernel, timeout }: Started): Promise<Leased | null> {
  clearTimeout(timeout);
  if (await kernel.restart().then(() => true).catch(() => false)) {
    return lend({ kernel, ready: true });
  }
  dispose(kernel);
  return null;
}

async function start(workbook: Workbook): Promise<Leased | null> {
  const { kernelManager } = workbook.context.sessionContext;
  const name = workbook.context.model.defaultKernelName;
  if (!kernelManager || !name) {
    console.warn('kernels start error, missing kernel manager or name');
    return null;
  }
  try {
    const kernel = await kernelManager.startNew({ name });
    return lend({ kernel, ready: true });
  } catch (error) {
    console.warn('start kernel error', error);
  }
  return null;
}
