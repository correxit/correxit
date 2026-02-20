import { grader } from '../corrector/grader';

const workbook = (path: string) =>
  ({
    context: { path }
  }) as any;

const source = async function* (paths: string[]) {
  for (const path of paths) {
    yield workbook(path);
  }
};

describe('grader', () => {
  it('yields all graded workbooks even when all settle before draining', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected = [] as string[];
    const correct = jest.fn(async (workbook: any) => ({
      grade: {
        path: workbook.context.path,
        score: { status: 'unscored' },
        spec: null
      },
      identifier: { assignee: null, assignment: 'x', signature: null },
      timestamp: 1,
      workbook
    }));

    for await (const graded of grader(source(paths), correct as any, 5)) {
      collected.push(graded.grade.path);
    }

    expect(collected.sort()).toEqual(paths.slice().sort());
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });

  it('continues grading after per-workbook failures', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected = [] as string[];
    const correct = jest.fn(async (workbook: any) => {
      if (workbook.context.path === 'b.ipynb') {
        throw new Error('boom');
      }
      return {
        grade: {
          path: workbook.context.path,
          score: { status: 'unscored' },
          spec: null
        },
        identifier: { assignee: null, assignment: 'x', signature: null },
        timestamp: 1,
        workbook
      };
    });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for await (const graded of grader(source(paths), correct as any, 2)) {
        collected.push(graded.grade.path);
      }
    } finally {
      warn.mockRestore();
    }

    expect(collected.sort()).toEqual(['a.ipynb', 'c.ipynb']);
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });
});
