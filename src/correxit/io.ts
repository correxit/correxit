import { PathExt } from '@jupyterlab/coreutils';
import { Context } from '@jupyterlab/docregistry';
import { INotebookContent } from '@jupyterlab/nbformat';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { Contents, ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { Correxit, Workbook } from '..';

type Rack = {
  count: number;
  free: number[];
  ready: Map<number, Promise<void>>;
  root: Promise<void> | null;
  used: Set<number>;
  waiters: Array<() => void>;
};

export type Staged = {
  path: string;
  release: () => Promise<void>;
};

const racks = new Map<string, Rack>();
const home = '';
const scratch = 'correxit-corrector';

const claim = async(
  root: string,
  capacity: number
): Promise<{ index: number; release: () => Promise<void> }> => {
  const kept = rack(root);
  const limit = Math.max(1, capacity);
  let position = vacant(kept, limit);
  while (position < 0 && kept.count >= limit) {
    await new Promise<void>(resolve => kept.waiters.push(resolve));
    position = vacant(kept, limit);
  }

  const index = position >= 0 ? kept.free.splice(position, 1)[0] : kept.count++;
  let released = false;
  kept.used.add(index);
  return {
    index,
    release: async () => {
      if (released) return;
      released = true;
      if (!kept.used.delete(index)) return;
      kept.free.push(index);
      kept.waiters.shift()?.();
    }
  };
};

const clear = async(
  { contents }: ServiceManager.IManager,
  path: string
): Promise<void> => {
  const slot = await contents.get(path, { content: true });
  const entries = (slot.content as Contents.IModel[]) || [];
  await Promise.all(entries.map(({ path }) => contents.delete(path)));
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

const encode = (data: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < data.length; i += 8192)
    binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(binary);
};

const mount = async(
  manager: ServiceManager.IManager,
  dir: string,
  root: string,
  index: number
): Promise<void> => {
  const kept = rack(root);
  if (!kept.root) {
    const rooted = directory(manager, dir, root);
    kept.root = rooted;
    void rooted.catch(() => {
      if (kept.root === rooted) kept.root = null;
    });
  }

  let ready = kept.ready.get(index);
  if (!ready) {
    const path = PathExt.join(root, `slot-${index + 1}`);
    ready = kept.root.then(() => directory(manager, root, path));
    kept.ready.set(index, ready);
    void ready.catch(() => {
      if (kept.ready.get(index) === ready) kept.ready.delete(index);
    });
  }
  await ready;
};

const rack = (root: string): Rack => {
  if (!racks.has(root)) {
    racks.set(root, {
      count: 0,
      free: [],
      ready: new Map(),
      root: null,
      used: new Set(),
      waiters: []
    });
  }
  return racks.get(root)!;
};

const sidecar = (dir: string, name: string): string => {
  if (!name || name === '.' || name === '..' || PathExt.basename(name) !== name)
    throw new Correxit.Error.Fetch(`Invalid resource name: ${name}`);
  return PathExt.join(dir, name);
};

const vacant = (kept: Rack, limit: number): number => {
  for (let position = kept.free.length - 1; position >= 0; position--)
    if (kept.free[position] < limit) return position;
  return -1;
};

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
  const path = sidecar(dir, name);
  try {
    const file = await contents.get(path, { format: 'base64', content: true });
    const binary = atob(file.content as string);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  } catch {
    throw new Correxit.Error.Fetch(`Could not load resource file: ${path}`);
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
 * Creates or reuses top-level `correxit-corrector/slot-N/`, clears any files
 * left by a prior occupant, saves the notebook there, and copies each sidecar
 * file from `dir` into the same slot.
 *
 * @returns the path of the staged notebook.
 */
export async function stage({ capacity, dir, manager, notebook, resources } : {
  capacity: number;
  dir: string;
  manager: ServiceManager.IManager;
  notebook: INotebookContent;
  resources: string[] | null;
}): Promise<Staged> {
  const { contents } = manager;
  const root = scratch;
  const slot = await claim(root, capacity);
  const subdirectory = PathExt.join(root, `slot-${slot.index + 1}`);
  const staged = PathExt.join(subdirectory, 'workbook.ipynb');
  try {
    await mount(manager, home, root, slot.index);
    await clear(manager, subdirectory);
    await Promise.all([
      contents.save(staged, {
        type: 'notebook',
        format: 'json',
        content: notebook
      }),
      ...(resources ?? []).map(name =>
        contents.copy(sidecar(dir, name), subdirectory)
      )
    ]);
    return { path: staged, release: slot.release };
  } catch (error) {
    await slot.release();
    throw error;
  }
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
