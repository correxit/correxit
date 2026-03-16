import { URLExt } from '@jupyterlab/coreutils';
import { Correxit, Workbook } from '..';
import * as security from '../security';

export namespace Moodle {
  type Assignment = { cmid: number; duedate: number; id: number; name: string };

  type Course = {
    assignments: Assignment[];
    fullname?: string;
    id: number;
    shortname?: string;
  };

  export type Settings = { token: string; url: string };

  export type User = {
    email?: string;
    fullname?: string;
    id: number;
    idnumber?: string;
    roles?: { shortname?: string }[];
    username?: string;
  };

  const api = (url: string, token: string) => {
    const endpoint = `${url}/webservice/rest/server.php`;
    return async <T>(action: string, params = ''): Promise<T> => {
      const body = new URLSearchParams(params);
      body.set('wstoken', token);
      body.set('wsfunction', action);
      body.set('moodlewsrestformat', 'json');

      const response = await fetch(endpoint, { method: 'POST', body });
      if (!response.ok)
        throw new Error(`${action} failed (status ${response.status})`);

      const payload = await response.json();
      if (payload && typeof payload === 'object' && 'exception' in payload)
        throw new Error((payload.message as string) || `${action} failed`);
      return payload as T;
    };
  };
  const identify = ({ email, fullname, id, idnumber, username }: User) =>
    username || email || idnumber || fullname || `${id}`;
  const student = ({ roles = [] }: User): boolean =>
    !roles.length || roles.some(({ shortname }) => shortname === 'student');
  const normalize = (records: User[]): string[] =>
    [...new Set(records.filter(student).map(identify))].filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  const upload = async (
    url: string,
    token: string,
    content: string,
    filename: string
  ): Promise<number | null> => {
    const form = new FormData();
    const blob = new Blob([content], { type: 'application/json' });
    form.append('token', token);
    form.append('filearea', 'draft');
    form.append('itemid', '0');
    form.append('file_1', blob, filename);

    const response = await fetch(`${url}/webservice/upload.php`, {
      method: 'POST',
      body: form
    });
    if (!response.ok) {
      const reason = await response.text().catch(() => '');
      const message = reason ||
        `Upload failed (${response.status} ${response.statusText})`;
      throw new Error(message);
    }

    const draft = await response.json();
    if (Array.isArray(draft) && draft[0]?.itemid) return draft[0].itemid;

    const reason = draft?.error || draft?.message || 'Upload returned no item';
    throw new Error(reason);
  };
  const filename = async (assignment: string, assignee: string) => {
    const name = assignment.replace(/[^\w.-]/g, '');
    const local = assignee.split('@')[0].replace(/[^\w.-]/g, '');
    const hash = (await security.digest(assignee)).slice(0, 4);
    return `${name}-${local}-${hash}.ipynb`;
  };


  export async function collector(
    certified: Workbook.Certified,
    settings: Settings
  ): Promise<string | null> {
    const { token, url: raw } = settings;
    const url = URLExt.normalize(raw);
    if (!token || !url) throw new Error('Moodle URL or token not configured');

    const rubric = Workbook.open(certified.workbook, true);
    if (!rubric) throw new Error('collector error: no rubric');

    const compound = rubric.assignment.id;
    if (!compound) throw new Error('collector error: no external assignment ID');

    const [course, assignment] = compound.split(':');
    if (!course || !assignment)
      throw new Error('collector error: invalid assignment ID format');

    const request = api(url, token);
    const { assignee } = certified.identifier;
    const users: User[] = await request(
      'core_enrol_get_enrolled_users',
      `&courseid=${course}`
    );
    const uid = users.find(user => identify(user) === assignee)?.id;
    if (uid === undefined)
      throw new Error(`collector error: no Moodle user for ${assignee}`);

    const notebook = certified.workbook.context.model.sharedModel.toJSON();
    const content = JSON.stringify(notebook);
    const file = await filename(rubric.assignment.name, assignee);
    const item = await upload(url, token, content, file);
    if (!item) throw new Error(`collector error: upload failed (${assignee})`);

    const { points } = certified.grade.score;
    await request(
      'mod_assign_save_grade',
      [
        `assignmentid=${assignment}`,
        `userid=${uid}`,
        `grade=${points}`,
        'attemptnumber=-1',
        'addattempt=0',
        'workflowstate=',
        'applytoall=0',
        `plugindata[files_filemanager]=${item}`
      ].join('&')
    );

    return `moodle:${assignment}:${uid}:${item}`;
  }

  export async function* consumer(
    { rubric, stream }: Parameters<Correxit.Consumer>[0],
    settings: Settings
  ): ReturnType<Correxit.Consumer> {
    const token = settings.token;
    const url = URLExt.normalize(settings.url);
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

    const possible = Object.values(rubric.cells)
      .reduce((sum, cell) => sum + cell.points, 0);
    const request = api(url, token);
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

    let users: User[];
    try {
      users = await request(
        'core_enrol_get_enrolled_users',
        `&courseid=${course}`
      );
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      yield { type: 'error', slots: [message] };
      return;
    }

    const participants = new Map(users.map(user => [identify(user), user.id]));
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
      const file = await filename(rubric.assignment.name, assignee);
      let item: number | null = null;
      try {
        item = await upload(url, token, content, file);
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
      yield { type: 'saved', slots: [file] };
      yield { type: 'progress', slots: [++progress, total] };
    }
    yield { type: 'success', slots: [total] };
  }

  export async function registrar(
    workbook: Workbook,
    identifier: Workbook.Identifier,
    settings: Settings
  ): ReturnType<Correxit.Registrar> {
    const token = settings.token;
    const url = URLExt.normalize(settings.url);
    if (!token || !url) return null;

    const request = api(url, token);
    const records: { courses: Course[] } = await request(
      'mod_assign_get_assignments'
    );
    const populated = ({ assignments }: Course) => assignments.length > 0;
    const courses = records.courses.filter(populated)
      .sort(
        (a, b) =>
          a.id - b.id ||
          (a.fullname || a.shortname || '').localeCompare(
            b.fullname || b.shortname || ''
          )
      );
    const rosters = await Promise.all(
      courses.map(async ({ id }) => {
        const users: User[] = await request(
          'core_enrol_get_enrolled_users',
          `&courseid=${id}`
        );
        return [id, normalize(users)] as const;
      })
    );
    const roster = Object.fromEntries(rosters);
    return courses.map(course => ({
      assignments: course.assignments
        .map(assignment => ({
          expiration: assignment.duedate ? assignment.duedate * 1000 : null,
          id: `${course.id}:${assignment.id}:${assignment.cmid}`,
          name: assignment.name,
          roster: roster[course.id] ?? []
        }))
        .sort(
          (a, b) =>
            Number(a.id || 0) - Number(b.id || 0) ||
            a.name.localeCompare(b.name)
        ),
      group: course.fullname || course.shortname || String(course.id)
    }));
  }
}
