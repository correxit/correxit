import { Moodle } from '../correxit/providers/moodle';

it('uploads the identified filename for both delivery and collection', async () => {
  const identifier = {
    assignment: '2:5',
    assignee: 'student',
    rubric: 'rubric',
    issue: null,
    file: 'issued-notebook.ipynb'
  };
  const common = {
    identifier,
    path: 'local/notebook.ipynb',
    notebook: { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }
  };
  const settings = { url: 'https://moodle.example', token: 'test' };
  const names: string[] = [];
  const fetch = globalThis.fetch;
  const response = (json: unknown) =>
    ({ ok: true, json: async () => json }) as Response;
  globalThis.fetch = jest.fn(async (_url, init?: RequestInit) => {
    const body = init?.body;
    if (body instanceof FormData) {
      names.push((body.get('file_1') as File).name);
      return response([{ itemid: 17 }]);
    }
    if (
      body instanceof URLSearchParams &&
      body.get('wsfunction') === 'core_enrol_get_enrolled_users'
    )
      return response([{ id: 8, username: 'student' }]);
    return response({ courses: [] });
  });
  try {
    await Moodle.distributor(
      { ...common, overwrite: true, resources: null },
      settings
    );
    await Moodle.collector(
      {
        ...common,
        name: 'A different display name',
        certification: 1,
        score: {
          code: '',
          comment: '',
          points: 1,
          possible: 1,
          status: 'correct'
        }
      },
      settings
    );
    expect(names).toEqual([identifier.file, identifier.file]);
  } finally {
    globalThis.fetch = fetch;
  }
});
