import { Correxit, Workbook } from '.';

export type Provider = 'manual' | 'moodle';

export type Settings = { moodle: { token: string; url: string } };

export const manual: Correxit.Registrar = async () => null;

export async function moodle(
  workbook: Workbook,
  identifier: Workbook.Identifier,
  settings: Settings['moodle']
): ReturnType<Correxit.Registrar> {
    type Assignment = { duedate: number; id: number; name: string };
    type Course = {
      assignments: Assignment[];
      fullname?: string;
      id: number;
      shortname?: string;
    };
    type User = {
      email?: string;
      fullname?: string;
      id: number;
      idnumber?: string;
      roles?: { shortname?: string }[];
      username?: string;
    };

    const token = settings.token;
    const url = settings.url.replace(/\/+$/, '');
    if (!token || !url) return null;

    const endpoint = `${url}/webservice/rest/server.php`;
    const query = (action: string, params = '') =>
      `${endpoint}?wstoken=${encodeURIComponent(token)}` +
      `&wsfunction=${action}` +
      `&moodlewsrestformat=json${params}`;

    async function request<T>(action: string, params = ''): Promise<T> {
      const response = await fetch(query(action, params));
      if (!response.ok)
        throw new Error(`${action} failed (status ${response.status})`);

      const payload = await response.json();
      if (payload && typeof payload === 'object' && 'exception' in payload)
        throw new Error(payload.message as string || `${action} failed`);
      return payload as T;
    }

    const student = ({ roles = [] }: User): boolean =>
      !roles.length ||
      roles.some(({ shortname }) => shortname === 'student');
    const identify = ({ email, fullname, id, idnumber, username }: User) =>
      username || email || idnumber || fullname || `${id}`;
    const normalize = (records: User[]): string[] =>
      [...new Set(records.filter(student).map(identify))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    const action = 'mod_assign_get_assignments';
    const records: { courses: Course[] } = await request(action);
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
        const action = 'core_enrol_get_enrolled_users';
        const query = `&courseid=${id}`;
        const users: User[] = await request(action, query);
        return [id, normalize(users)] as const;
      })
    );
    const roster = Object.fromEntries(rosters);
    const registered = courses.map(course => ({
      assignments: course.assignments
        .map(assignment => ({
          expiration: assignment.duedate ? assignment.duedate * 1000 : null,
          id: String(assignment.id),
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
    return registered;
}
