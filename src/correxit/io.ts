import { PathExt } from '@jupyterlab/coreutils';
import { Context } from '@jupyterlab/docregistry';
import { INotebookContent } from '@jupyterlab/nbformat';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { Contents, ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { Correxit, Workbook } from '..';
import * as security from './security';

const encode = (data: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < data.length; i += 8192)
    binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(binary);
};

const directory = async(
  manager: ServiceManager.IManager,
  pwd: string,
  path: string
): Promise<void> => {
  try {
    await manager.contents.get(path, { content: false });
  } catch {
    await mkdir(manager, pwd, path);
  }
};

/** @returns a deterministic filename for an assigned workbook. */
export async function assigned(assignment: string, assignee: string) {
  const name = assignment.replace(/[^\w.-]/g, '');
  const local = assignee.split('@')[0].replace(/[^\w.-]/g, '');
  const hash = (await security.digest(assignee)).slice(0, 4);
  return `${name}-${local}-${hash}.ipynb`;
}

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

/** @returns the raw bytes of a co-located resource file. */
export async function load(
  { contents }: Pick<ServiceManager.IManager, 'contents'>,
  dir: string,
  name: string
): Promise<Uint8Array> {
  if (PathExt.basename(name) !== name)
    throw new Correxit.Error.Fetch(`Invalid resource name: ${name}`);
  const path = PathExt.join(dir, name);
  const file = await contents
    .get(path, { format: 'base64', content: true })
    .catch(() => {
      throw new Correxit.Error.Fetch(`Could not load resource file: ${path}`);
    }) as Contents.IModel;
  const binary = atob(file.content as string);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
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

/** @returns notebooks in a directory sorted lexically by name. */
export async function notebooks(
  { contents }: Pick<ServiceManager.IManager, 'contents'>,
  path: string
): Promise<Contents.IModel[]> {
  const response = await contents.get(path, { content: true });
  if (response.type !== 'directory')
    throw new Correxit.Error.Fetch(`Not a directory: ${path}`);

  const notebook = ({ type }: Contents.IModel) => type === 'notebook';
  const lexical = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  return (response.content || []).filter(notebook).sort(lexical);
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

/** @returns non-notebook files in a directory sorted lexically by name. */
export async function resources(
  { contents }: Pick<ServiceManager.IManager, 'contents'>,
  path: string
): Promise<Contents.IModel[]> {
  const response = await contents.get(path, { content: true });
  if (response.type !== 'directory')
    throw new Correxit.Error.Fetch(`Not a directory: ${path}`);

  const resource = ({ type }: Contents.IModel) => type === 'file';
  const lexical = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  return (response.content || []).filter(resource).sort(lexical);
}

/**
 * Stage a workbook for isolated execution.
 *
 * Creates `correxit-corrector/<stem>/` under `dir`, copies the notebook
 * there, and copies each sidecar file from `dir` into the same slot.
 *
 * @returns the path of the staged notebook.
 */
export async function stage(
  manager: ServiceManager.IManager,
  dir: string,
  path: string,
  resources: string[] | null
): Promise<string> {
  const { contents } = manager;
  const stem = PathExt.basename(path, '.ipynb');
  const root = PathExt.join(dir, 'correxit-corrector');
  const subdirectory = PathExt.join(dir, 'correxit-corrector', stem);
  await directory(manager, dir, root);
  await contents.delete(subdirectory).catch(() => undefined);
  await mkdir(manager, root, subdirectory);

  try {
    const copied = await contents.copy(path, subdirectory);
    await Promise.all(
      (resources ?? []).map(name =>
        contents.copy(PathExt.join(dir, name), subdirectory)
      )
    );
    return copied.path;
  } catch (error) {
    await unstage(manager, dir, stem);
    throw error;
  }
}

/** Removes a staging slot created by `stage`. */
export async function unstage(
  { contents }: Pick<ServiceManager.IManager, 'contents'>,
  dir: string,
  stem: string
): Promise<void> {
  const slot = PathExt.join(dir, 'correxit-corrector', stem);
  await contents.delete(slot).catch(() => undefined);
}

/** Writes raw bytes to a file path. */
export async function write(
  { contents }: Pick<ServiceManager.IManager, 'contents'>,
  path: string,
  data: Uint8Array
): Promise<void> {
  await contents.save(path, {
    content: encode(data),
    format: 'base64',
    type: 'file'
  });
}
