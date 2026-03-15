import { PathExt } from '@jupyterlab/coreutils';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { Correxit } from '.';
import * as io from './io';

export function manual(
  commands: CommandRegistry,
  factory: NotebookModelFactory,
  manager: ServiceManager.IManager
): Correxit.Consumer {
  return async function* consumer({ path, rubric, stream }) {
    let progress = 0;
    const total = rubric.assignment.roster.length;
    const parent = PathExt.dirname(path);
    const base = PathExt.basename(path, '.ipynb');
    const potential = await io.available(manager, parent, base);
    const directory = await io.mkdir(manager, parent, potential);
    const pwd = directory.path;
    const location = { base, pwd };
    yield { type: 'mkdir', slots: [directory.path] };
    for await (const propagated of await stream(location)) {
      const { identifier, notebook, path } = propagated;
      const created = await io.create({ factory, manager, notebook, path });
      yield { type: 'separator', slots: [] };
      yield { type: 'assigned', slots: [identifier.assignee] };
      yield { type: created ? 'saved' : 'create-error', slots: [path] };
      yield { type: 'progress', slots: [++progress, total] };
    }
    await io.cd(commands, directory.path);
    yield { type: 'success', slots: [total] };
  };
}
