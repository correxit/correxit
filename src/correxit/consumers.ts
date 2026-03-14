import { PathExt } from '@jupyterlab/coreutils';
import { NotebookModelFactory } from '@jupyterlab/notebook';
import { ServiceManager } from '@jupyterlab/services';
import { CommandRegistry } from '@lumino/commands';
import { Correxit } from '.';
import * as io from './io';
import { Moodle } from './moodle';

export type Provider = 'manual' | 'moodle';

export type Settings = { moodle: { url: string } };

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
    const potential = await io.folder(manager, parent, base);
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

export function moodle(
  settings: Settings['moodle'] & { token: string }
): Correxit.Consumer {
  return async function* consumer({ rubric, stream }) {
    const token = settings.token;
    const url = settings.url.replace(/\/+$/, '');
    if (!token || !url) {
      yield { type: 'error', slots: ['Moodle URL or token not configured'] };
      return;
    }

    const compound = rubric.assignment.id;
    if (!compound) {
      yield { type: 'error', slots: ['No external assignment ID'] };
      return;
    }

    const [course, assignment, cmid] = compound.split(':');
    if (!course || !assignment || !cmid) {
      yield { type: 'error', slots: ['Invalid assignment ID format'] };
      return;
    }

    const possible = Object.values(rubric.cells).reduce(
      (sum, cell) => sum + cell.points, 0
    );

    const request = Moodle.request(url, token);
    try {
      await request(
        'core_grades_update_grades',
        [
          'source=correxit',
          `courseid=${course}`,
          'component=mod_assign',
          `activityid=${cmid}`,
          'itemnumber=0',
          `itemdetails[grademax]=${possible}`
        ].join('&')
      );
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      yield { type: 'error', slots: [`Set maximum grade failed: ${message}`] };
      return;
    }
    yield { type: 'max-score', slots: [possible] };

    const action = 'core_enrol_get_enrolled_users';
    let users: Moodle.User[];
    try {
      users = await request(action, `&courseid=${course}`);
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      yield { type: 'error', slots: [message] };
      return;
    }

    const participants = new Map(users.map(
      user => [Moodle.identify(user), user.id]
    ));
    const total = rubric.assignment.roster.length;
    let progress = 0;
    for await (const { identifier, notebook } of await stream(null)) {
      const { assignee } = identifier;
      const uid = participants.get(assignee);
      if (uid === undefined) {
        yield { type: 'separator', slots: [] };
        yield { type: 'assigned', slots: [assignee] };
        yield { type: 'error', slots: [`No Moodle user for ${assignee}`] };
        yield { type: 'progress', slots: [++progress, total] };
        continue;
      }

      const content = JSON.stringify(notebook);
      const filename = `${assignee.split('@')[0]}.ipynb`;

      let item: number | null = null;
      try {
        item = await Moodle.upload(url, token, content, filename);
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        yield { type: 'separator', slots: [] };
        yield { type: 'assigned', slots: [assignee] };
        yield { type: 'error', slots: [`Upload failed: ${message}`] };
        yield { type: 'progress', slots: [++progress, total] };
        continue;
      }

      if (!item) {
        yield { type: 'separator', slots: [] };
        yield { type: 'assigned', slots: [assignee] };
        yield { type: 'error', slots: [`Upload failed for ${assignee}`] };
        yield { type: 'progress', slots: [++progress, total] };
        continue;
      }

      try {
        await request(
          'mod_assign_save_grade',
          [
            `assignmentid=${assignment}`,
            `userid=${uid}`,
            'grade=-1',
            'attemptnumber=-1',
            'addattempt=0',
            'workflowstate=',
            'applytoall=0',
            `plugindata[files_filemanager]=${item}`
          ].join('&')
        );
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        yield { type: 'separator', slots: [] };
        yield { type: 'assigned', slots: [assignee] };
        yield { type: 'error', slots: [`Grade save failed: ${message}`] };
        yield { type: 'progress', slots: [++progress, total] };
        continue;
      }

      yield { type: 'separator', slots: [] };
      yield { type: 'assigned', slots: [assignee] };
      yield { type: 'saved', slots: [filename] };
      yield { type: 'progress', slots: [++progress, total] };
    }
    yield { type: 'success', slots: [total] };
  };
}
