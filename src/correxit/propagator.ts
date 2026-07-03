import { PathExt } from '@jupyterlab/coreutils';
import { INotebookContent } from '@jupyterlab/nbformat';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { Assignment, Correxit, Workbook } from '.';
import * as io from './io';
import * as security from './security';

export type Emission = { slots: (string | number)[]; type: string; };

export type Emitter = AsyncIterable<Emission>;

export async function* propagate({
  commands,
  distributor,
  factory,
  manager,
  overwrite,
  workbook
}: {
  commands: CommandRegistry;
  distributor: Correxit.Distributor;
  factory: NotebookModelFactory;
  manager: ServiceManager.IManager;
  overwrite: boolean;
  workbook: Workbook;
}): AsyncGenerator<Emission> {
  const rubric = Workbook.open(workbook, true);
  if (!rubric || rubric.locked) {
    yield { type: 'error', slots: ['invalid rubric'] };
    return;
  }
  try {
    const {
      assignment: { roster },
      key
    } = rubric;
    const path = workbook.context.path;
    const parent = PathExt.dirname(path);
    const stem = PathExt.basename(path, '.ipynb');
    const potential = await io.available(manager, parent, stem);
    const directory = await io.mkdir(manager, parent, potential);
    const total = roster.length;
    const source = workbook.context.model.sharedModel.toJSON();
    const { encrypted, notebook: content } = await Assignment.prepare(
      source,
      rubric
    );
    const author = await security.decrypt(
      rubric.assignment.keys.private.author,
      rubric.key
    );
    let progress = 0;
    yield { type: 'mkdir', slots: [directory.path] };
    for (const reference of encrypted)
      yield { type: 'encrypted', slots: [reference] };

    const load = async (name: string) =>
      ({ name, data: await io.load(manager, parent, name) });
    let resources: Correxit.Resource[] | null = null;
    if (rubric.assignment.resources) {
      try {
        resources = await Promise.all(rubric.assignment.resources.map(load));
        await Promise.all(resources.map(({ data, name }) =>
          io.write(manager, PathExt.join(directory.path, name), data)
        ));
      } catch (error) {
        yield { type: 'error', slots: [`${error}`] };
        return;
      }
    }
    for (const assignee of roster) {
      yield { type: 'separator', slots: [] };
      const notebook: INotebookContent = JSON.parse(JSON.stringify(content));
      const file = await Assignment.filename(stem, assignee);
      const path = PathExt.join(directory.path, file);
      const issued = await Assignment.issue({
        assignee,
        author,
        distribution: null,
        file,
        key,
        notebook,
        roster
      });
      const { identifier } = issued;
      const propagated = { identifier, notebook, overwrite, path, resources };
      Assignment.stamp(notebook, Date.now());

      let distributed = true;
      try {
        if (!await distributor(propagated)) {
          yield { type: 'skipped', slots: [assignee] };
          yield { type: 'progress', slots: [++progress, total] };
          continue;
        }
      } catch (error) {
        Assignment.stamp(notebook, null);
        distributed = false;
        yield {
          type: 'distribute-error',
          slots: [assignee, path, `${error}`]
        };
      }

      const created = await io.create({ factory, manager, notebook, path });
      yield { type: 'assigned', slots: [assignee] };
      yield { type: created ? 'saved' : 'create-error', slots: [path] };
      if (created && distributed)
        yield { type: 'distributed', slots: [assignee] };
      yield { type: 'progress', slots: [++progress, total] };
    }
    await io.cd(commands, directory.path);
    yield { type: 'success', slots: [total] };
  } catch (error) {
    yield { type: 'error', slots: [`${error}`] };
  }
}
