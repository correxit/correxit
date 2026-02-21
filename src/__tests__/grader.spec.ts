import { PromiseDelegate } from '@lumino/coreutils';
import { Workbook } from '..';
import { grader } from '../corrector/grader';

type Certified = Workbook.Certified;
type Headless = Workbook.Headless;

const workbook = (path: string): Headless =>
  ({ context: { path } }) as unknown as Headless;

const grade = (workbook: Headless): Certified =>
  ({
    grade: {
      path: workbook.context.path,
      score: { status: 'unscored' },
      spec: null
    },
    identifier: { assignee: null, assignment: 'x', signature: null },
    timestamp: 1,
    workbook
  }) as unknown as Certified;

const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const source = async function* (paths: string[]): AsyncGenerator<Headless> {
  for (const path of paths) {
    yield workbook(path);
  }
};

describe('grader', () => {
  it('yields nothing for an empty scan', async () => {
    const collected: string[] = [];
    const correct = jest.fn(async (workbook: Headless) => grade(workbook));

    for await (const graded of grader(source([]), correct, 5, 0)) {
      collected.push(graded.grade.path);
    }

    expect(collected).toEqual([]);
    expect(correct).toHaveBeenCalledTimes(0);
  });

  it('yields all grades when all settle before drain', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: string[] = [];
    const correct = jest.fn(async (workbook: Headless) => grade(workbook));

    for await (const graded of grader(source(paths), correct, 5, 0)) {
      collected.push(graded.grade.path);
    }

    expect(collected.sort()).toEqual(paths.slice().sort());
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });

  it('continues grading after per-workbook failures', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: string[] = [];
    const correct = jest.fn(async (workbook: Headless) => {
      if (workbook.context.path === 'b.ipynb') {
        throw new Error('boom');
      }
      return grade(workbook);
    });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for await (const graded of grader(source(paths), correct, 2, 0)) {
        collected.push(graded.grade.path);
      }
    } finally {
      warn.mockRestore();
    }

    expect(collected.sort()).toEqual(['a.ipynb', 'c.ipynb']);
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });

  it('clamps non-positive limit to one in-flight workbook', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const gates: Record<string, PromiseDelegate<void>> = Object.fromEntries(
      paths.map(path => [path, new PromiseDelegate<void>()])
    );
    let active = 0;
    let peak = 0;
    const correct = jest.fn(async (workbook: Headless) => {
      active++;
      peak = Math.max(peak, active);
      await gates[workbook.context.path].promise;
      active--;
      return grade(workbook);
    });

    const pending = (async () => {
      const collected: string[] = [];
      for await (const graded of grader(source(paths), correct, 0, 0)) {
        collected.push(graded.grade.path);
      }
      return collected;
    })();

    await wait();
    expect(correct).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);

    gates['a.ipynb'].resolve();
    await wait();
    expect(correct).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);

    gates['b.ipynb'].resolve();
    await wait();
    expect(correct).toHaveBeenCalledTimes(3);
    expect(peak).toBe(1);

    gates['c.ipynb'].resolve();
    const collected = await pending;
    expect(collected.sort()).toEqual(paths.slice().sort());
  });

  it('does not exceed configured in-flight limit', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb', 'd.ipynb'];
    const gates: Record<string, PromiseDelegate<void>> = Object.fromEntries(
      paths.map(path => [path, new PromiseDelegate<void>()])
    );
    let active = 0;
    let peak = 0;
    const correct = jest.fn(async (workbook: Headless) => {
      active++;
      peak = Math.max(peak, active);
      await gates[workbook.context.path].promise;
      active--;
      return grade(workbook);
    });

    const pending = (async () => {
      const collected: string[] = [];
      for await (const graded of grader(source(paths), correct, 2, 0)) {
        collected.push(graded.grade.path);
      }
      return collected;
    })();

    await wait();
    expect(correct).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);

    gates['a.ipynb'].resolve();
    await wait();
    expect(correct).toHaveBeenCalledTimes(3);
    expect(peak).toBe(2);

    gates['b.ipynb'].resolve();
    await wait();
    expect(correct).toHaveBeenCalledTimes(4);
    expect(peak).toBe(2);

    gates['c.ipynb'].resolve();
    gates['d.ipynb'].resolve();
    const collected = await pending;
    expect(collected.sort()).toEqual(paths.slice().sort());
  });

  it('abandons workbooks that exceed the timeout', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: string[] = [];
    const delegates: Record<string, PromiseDelegate<void>> = Object.fromEntries(
      paths.map(path => [path, new PromiseDelegate<void>()])
    );
    const correct = jest.fn(async (workbook: Headless) => {
      await delegates[workbook.context.path].promise;
      return grade(workbook);
    });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pending = (async () => {
        for await (const graded of grader(source(paths), correct, 3, 10)) {
          collected.push(graded.grade.path);
        }
      })();

      // Let the timeout elapse for all three.
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      await pending;

      expect(collected).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(paths.length);
      expect(
        warn.mock.calls.every(([, , e]) => e.message === 'grader timeout')
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('drains and completes when all workbooks fail', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: string[] = [];
    const correct = jest.fn(async () => {
      throw new Error('boom');
    });

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for await (const graded of grader(source(paths), correct, 3, 0)) {
        collected.push(graded.grade.path);
      }
      expect(warn).toHaveBeenCalledTimes(paths.length);
    } finally {
      warn.mockRestore();
    }

    expect(collected).toEqual([]);
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });
});
