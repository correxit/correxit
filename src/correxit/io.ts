import { PathExt } from '@jupyterlab/coreutils';
import { Context } from '@jupyterlab/docregistry';
import { INotebookContent } from '@jupyterlab/nbformat';
import { INotebookModel, NotebookModelFactory } from '@jupyterlab/notebook';
import { Contents, ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { Workbook } from '..';
import * as security from './security';

export async function cd(commands: CommandRegistry, path: string) {
  if (commands.hasCommand('filebrowser:go-to-path')) {
    commands.execute('filebrowser:go-to-path', { path });
  }
}

/**
 * @returns A promise that resolves to a headless workbook or null.
 */
export async function create(options: {
  factory: NotebookModelFactory;
  manager: ServiceManager.IManager;
  notebook: INotebookContent;
  path: string;
}): Promise<boolean> {
  const { notebook, factory, manager } = options;
  const { contents } = manager;
  const ext = '.ipynb';
  const path = PathExt.dirname(options.path);
  const type = 'notebook';
  let context: Context<INotebookModel> | null = null;
  try {
    const untitled = await contents.newUntitled({ ext, path, type });
    const renamed = await contents.rename(untitled.path, options.path)
    context = new Context({ manager, factory, path: renamed.path });
    await context.initialize(true);
    await context.ready;
    context.model.sharedModel.fromJSON(notebook);
    await context.save();
    context.dispose();
    return true;
  } catch (error) {
    console.warn('create error', error);
  }
  context?.dispose();
  return false;
}

export async function folder(
  manager: ServiceManager.IManager,
  pwd: string,
  seed: string
): Promise<string> {
  const response = await manager.contents.get(pwd);
  if (response.type !== 'directory') {
    throw new Error(`not a folder(${pwd}, ${seed})`);
  }
  const paths = (response.content as Contents.IModel[]).reduce(
    (paths, { path }) => paths.set(path, null),
    new Map<string, null>()
  );
  let suffix = 0;
  let folder: string;
  do {
    folder = PathExt.join(pwd, `${seed}${suffix ? `-${suffix}` : ''}`);
    suffix += 1;
  } while (paths.has(folder));
  return folder;
}

export async function mkdir(
  manager: ServiceManager.IManager,
  pwd: string,
  path: string
) {
  const type = 'directory';
  const created = await manager.contents.newUntitled({ path: pwd, type });
  return await manager.contents.rename(created.path, path);
}

export async function request(
  handle: Workbook.Credentials,
  factory: NotebookModelFactory,
  manager: ServiceManager.IManager
): Promise<Workbook.Headless | null> {
  const { path } = handle;
  const context = new Context({ manager, factory, path });
  const workbook = { content: null, context };
  await context.initialize(false);

  const rubric = Workbook.open(workbook, true);
  if (!rubric) {
    context.dispose();
    return null;
  }
  if (!rubric.locked || !(handle.passphrase || handle.key)) {
    return workbook;
  }
  try {
    const { passphrase } = handle;
    const key = handle.key || await security.keygen(passphrase!, rubric.id);
    await Workbook.unlock(workbook, key);
  } catch (error) {
    console.warn(`access error, ${path}`, error);
  }
  return workbook;
}
