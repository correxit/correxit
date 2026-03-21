import { PathExt } from '@jupyterlab/coreutils';
import { Context } from '@jupyterlab/docregistry';
import { INotebookContent } from '@jupyterlab/nbformat';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { Contents, ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { Correxit, Workbook } from '..';
import * as security from './security';

/** @returns an available path in pwd for the given seed name. */
export async function available(
  { contents }: Pick<ServiceManager.IManager, 'contents'>,
  pwd: string,
  seed: string,
  ext = ''
): Promise<string> {
  const response = await contents.get(pwd, { content: true });
  if (response.type !== 'directory')
    throw new Correxit.Error.Fetch(`Not a directory: ${pwd}`);

  const paths = (response.content as Contents.IModel[]).map(({ path }) => path);
  const parent = new Set(paths);
  for (let suffix = 0; ; suffix++) {
    const file = suffix ? `${seed}-${suffix}${ext}` : `${seed}${ext}`;
    const path = PathExt.join(pwd, file);
    if (!parent.has(path)) return path;
  }
}

/** @returns a deterministic filename for an assigned workbook. */
export async function assigned(assignment: string, assignee: string) {
  const name = assignment.replace(/[^\w.-]/g, '');
  const local = assignee.split('@')[0].replace(/[^\w.-]/g, '');
  const hash = (await security.digest(assignee)).slice(0, 4);
  return `${name}-${local}-${hash}.ipynb`;
}

/** Navigates the file browser to path. */
export async function cd(commands: CommandRegistry, path: string) {
  const command = 'filebrowser:go-to-path';
  if (commands.hasCommand(command)) commands.execute(command, { path });
}

/** @returns a headless workbook or null. */
export async function create(options: {
  factory: NotebookModelFactory;
  manager: ServiceManager.IManager;
  notebook: INotebookContent;
  path: string;
}): Promise<boolean> {
  const { notebook, factory, manager, manager: { contents } } = options;
  const ext = '.ipynb';
  const path = PathExt.dirname(options.path);
  const type = 'notebook';
  try {
    const untitled = await contents.newUntitled({ ext, path, type });
    const renamed = await contents.rename(untitled.path, options.path);
    const context = new Context({ factory, manager, path: renamed.path });
    try {
      await context.initialize(true);
      await context.ready;
      context.model.sharedModel.fromJSON(notebook);
      await context.save();
      return true;
    } finally {
      context.dispose();
    }
  } catch (error) {
    console.warn('create error', error);
    return false;
  }
}

/** Creates a directory at path inside pwd. */
export async function mkdir(
  { contents }: ServiceManager.IManager,
  pwd: string,
  path: string
) {
  const untitled = await contents.newUntitled({ path: pwd, type: 'directory' });
  return await contents.rename(untitled.path, path);
}

/** @returns a headless workbook, optionally unlocked, or null. */
export async function request(
  handle: Workbook.Credentials,
  factory: NotebookModelFactory,
  manager: ServiceManager.IManager,
  unlocker: Correxit.Unlocker,
  silent = false
): Promise<Workbook.Headless | null> {
  const { key, passphrase, path, unlock } = handle;
  const context = new Context({ manager, factory, path });
  const workbook = { content: null, context };
  await context.initialize(false);

  const rubric = Workbook.open(workbook, true);
  const unauthenticated = !(key || passphrase || unlock);
  if (!rubric) {
    context.dispose();
    return null;
  }
  if (!rubric.locked || unlock === false || unauthenticated) {
    await Workbook.lock(workbook);
    return workbook;
  }
  try {
    await unlocker.unlock(workbook, silent ? { ...handle, silent } : handle);
  } catch (error) {
    console.warn(`access error, ${path}`, error);
  }
  return workbook;
}
