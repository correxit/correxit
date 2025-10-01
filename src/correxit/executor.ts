import { Kernel } from '@jupyterlab/services';
import { Workbook } from '.';

const lifespan = 10000;
const pool = new Map<
  string, [Kernel.IKernelConnection, ReturnType<typeof setTimeout>]
>();

export async function initialize(
  context: Workbook['context'],
  reuse = false
): Promise<[Kernel.IKernelConnection | null, () => void]> {
  const { kernelManager } = context.sessionContext;
  const name = context.model.defaultKernelName;
  if (!kernelManager || !name) {
    console.warn('executor initialize error, missing kernel manager or name');
    return [null, () => {}];
  }

  const create = async (
    kernel?: Kernel.IKernelConnection
  ): ReturnType<typeof initialize> => {
    try {
      if (kernel) {
        const live = await kernel.restart().then(() => true).catch(_ => false);
        if (!live) {
          await kernel?.shutdown().catch(_ => kernel?.dispose());
          kernel = undefined;
        }
      }
      kernel ||= await kernelManager.startNew({ name });
      const dispose = () => kernel!.shutdown().catch(_ => kernel!.dispose());
      if (kernel && reuse) {
        pool.set(name, [kernel, 0]);
      }
      return [kernel, reuse ? release : dispose];
    } catch (error) {
      console.warn(`executor initialize error starting kernel ${name}`, error);
    }
    return [null, () => {}];
  };
  const release = () => {
    if (pool.has(name)) {
      const [kernel] = pool.get(name)!;
      const shutdown = () => {
        pool.delete(name);
        kernel.shutdown().catch(_ => kernel.dispose());
      };
      pool.set(name, [kernel, setTimeout(shutdown, lifespan)]);
    }
  };
  if (reuse && pool.has(name)) {
    const [kernel, timeout] = pool.get(name)!;
    pool.delete(name);
    clearTimeout(timeout);
    return create(kernel);
  }
  return create();
};
