import { URLExt } from '@jupyterlab/coreutils';
import { Correxit, Rubric, Workbook } from '..';
import * as Error from '../error';
import * as io from '../io';

export namespace Moodle {
  type Assignment = {
    duedate: number;
    grade: number;
    id: number;
    name: string;
  };

  type Course = {
    assignments: Assignment[];
    fullname?: string;
    id: number;
    shortname?: string;
  };

  type Grades = {
    assignments: { grades: { userid: number }[] }[];
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
        throw new Error.Plugin(`${action} failed (status ${response.status})`);

      const payload = await response.json();
      if (payload && typeof payload === 'object' && 'exception' in payload)
        throw new Error.Plugin(payload.message || `${action} failed`);
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
    content: string | ArrayBuffer,
    filename: string,
    itemid = 0
  ): Promise<number> => {
    const form = new FormData();
    const type = typeof content === 'string'
      ? 'application/json'
      : 'application/octet-stream';
    const blob = new Blob([content], { type });
    form.append('token', token);
    form.append('filearea', 'draft');
    form.append('itemid', String(itemid));
    form.append('file_1', blob, filename);

    const response = await fetch(`${url}/webservice/upload.php`, {
      method: 'POST',
      body: form
    });
    if (!response.ok) {
      const reason = await response.text().catch(() => '');
      const message = reason ||
        `Upload failed (${response.status} ${response.statusText})`;
      throw new Error.Plugin(message);
    }

    const draft = await response.json();
    if (Array.isArray(draft) && draft[0]?.itemid) return draft[0].itemid;

    const reason = draft?.error || draft?.message || 'Upload returned no item';
    throw new Error.Plugin(reason);
  };
  const TTL = 5 * 60_000;
  const participants: Map<
    string,
    { expires: number; users: Map<string, number> }
  > = new Map();

  const scales: Map<string, { expires: number; max: number }> = new Map();
  const scale = async (
    request: ReturnType<typeof api>,
    course: string,
    assignment: string
  ): Promise<number> => {
    const key = `${course}:${assignment}`;
    const cached = scales.get(key);
    if (cached && cached.expires > Date.now()) return cached.max;

    const records = await request<{ courses: Course[] }>(
      'mod_assign_get_assignments',
      `courseids[0]=${course}`
    );
    const found = records.courses
      .flatMap(({ assignments }) => assignments)
      .find(({ id }) => String(id) === assignment);
    const max = found && found.grade > 0 ? found.grade : 100;
    scales.set(key, { expires: Date.now() + TTL, max });
    return max;
  };
  const enroll = async (
    request: ReturnType<typeof api>,
    course: string
  ): Promise<Map<string, number>> => {
    const cached = participants.get(course);
    if (cached && cached.expires > Date.now()) return cached.users;

    const users: User[] = await request(
      'core_enrol_get_enrolled_users',
      `courseid=${course}`
    );
    const enrolled = new Map(users.map(user => [identify(user), user.id]));
    participants.set(course, { expires: Date.now() + TTL, users: enrolled });
    return enrolled;
  };

  export async function collector(
    certified: Workbook.Certified,
    settings: Settings
  ): Promise<string | null> {
    const { token, url: raw } = settings;
    const url = URLExt.normalize(raw);
    if (!token || !url)
      throw new Error.Plugin('Moodle URL or token not configured');

    const rubric = Workbook.open(certified.workbook, true);
    if (!rubric) throw new Error.Plugin('collector error: no rubric');

    const compound = rubric.assignment.id;
    if (!compound) throw new Error.Plugin('collector error: no assignment ID');

    const [course, assignment] = compound.split(':');
    if (!course || !assignment)
      throw new Error.Plugin('collector error: invalid assignment ID format');

    const request = api(url, token);
    const { assignee } = certified.identifier;
    const enrolled = await enroll(request, course);
    const uid = enrolled.get(assignee);
    if (uid === undefined)
      throw new Error.Plugin(`collector error: no Moodle user for ${assignee}`);

    const notebook = certified.workbook.context.model.sharedModel.toJSON();
    const content = JSON.stringify(notebook);
    const file = await io.assigned(rubric.assignment.name, assignee);
    const item = await upload(url, token, content, file);
    if (!item)
      throw new Error.Plugin(`collector error: upload failed (${assignee})`);

    const { points, possible } = certified.grade.score;
    const max = await scale(request, course, assignment);
    const grade = possible > 0 ? (points / possible) * max : 0;
    await request(
      'mod_assign_save_grade',
      [
        `assignmentid=${assignment}`,
        `userid=${uid}`,
        `grade=${grade}`,
        'attemptnumber=-1',
        'addattempt=0',
        'workflowstate=',
        'applytoall=0',
        `plugindata[files_filemanager]=${item}`
      ].join('&')
    );
    return `moodle:${assignment}:${uid}:${item}`;
  }

  export async function distributor(
    parameters: Parameters<Correxit.Distributor>[0],
    settings: Settings
  ): ReturnType<Correxit.Distributor> {
    const { identifier, notebook, overwrite, resources } = parameters;
    const { token, url: raw } = settings;
    const url = URLExt.normalize(raw);
    if (!token || !url)
      throw new Error.Plugin('Moodle URL or token not configured');
    if (!identifier.assignment)
      throw new Error.Plugin('No external assignment ID');

    const { assignee } = identifier;
    const [course, assignment] = identifier.assignment.split(':');
    if (!course || !assignment)
      throw new Error.Plugin('Invalid assignment ID format');

    const request = api(url, token);
    const user = (await enroll(request, course)).get(assignee);
    if (user === undefined)
      throw new Error.Plugin(`No Moodle user for ${assignee}`);

    if (!overwrite) {
      const result = await request<Grades>(
        'mod_assign_get_grades',
        `assignmentids[0]=${assignment}&userids[0]=${user}`
      );
      const assigned = result.assignments[0]?.grades
        .some(({ userid }) => userid === user);
      if (assigned) return false;
    }
    const metadata = notebook.metadata['correxit'] as Partial<Rubric.Locked>;
    const { name } = metadata.assignment as Partial<Rubric.Assignment>;
    const base =
      (name || `moodle-${course}-${assignment}`).toLocaleLowerCase();
    const file = await io.assigned(base, assignee);
    const content = JSON.stringify(notebook);
    let draft = await upload(url, token, content, file);
    if (resources) {
      for (const resource of resources) {
        draft = await upload(
          url, token, resource.data.buffer as ArrayBuffer,
          resource.name, draft
        );
      }
    }
    await request(
      'mod_assign_save_grade',
      [
        `assignmentid=${assignment}`,
        `userid=${user}`,
        'grade=-1',
        'attemptnumber=-1',
        'addattempt=0',
        'workflowstate=',
        'applytoall=0',
        `plugindata[files_filemanager]=${draft}`
      ].join('&')
    );
    return true;
  }

  export async function registrar(
    workbook: Workbook,
    identifier: Workbook.Identifier,
    settings: Settings
  ): ReturnType<Correxit.Registrar> {
    const { token, url: raw } = settings;
    const url = URLExt.normalize(raw);
    if (!token || !url) return null;

    const request = api(url, token);
    const records = await request<{ courses: Course[] }>(
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
      courses.map(async ({ id: course }) => {
        const users: User[] = await request(
          'core_enrol_get_enrolled_users',
          `courseid=${course}`
        );
        return [course, normalize(users)] as const;
      })
    );
    const roster = Object.fromEntries(rosters);
    return courses.map(course => ({
      assignments: course.assignments
        .map(assignment => ({
          expiration: assignment.duedate ? assignment.duedate * 1000 : null,
          id: `${course.id}:${assignment.id}`,
          name: assignment.name,
          roster: roster[course.id] ?? []
        }))
        .sort((a, b) => {
          if (a.expiration && b.expiration)
            return a.expiration - b.expiration || a.name.localeCompare(b.name);
          if (a.expiration) return -1;
          if (b.expiration) return 1;
          return a.name.localeCompare(b.name);
        }),
      group: course.fullname || course.shortname || String(course.id)
    }));
  }
}
