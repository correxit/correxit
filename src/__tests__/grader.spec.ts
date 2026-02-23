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
      resolved: true,
      score: { status: 'unscored' },
      spec: null
    },
    identifier: { assignee: null, assignment: 'x', signature: null },
    timestamp: 1,
    workbook
  }) as unknown as Certified;

const failed = (workbook: Headless): Certified =>
  ({
    grade: {
      path: workbook.context.path,
      resolved: false,
      score: { status: 'unscored' },
      spec: null
    },
    identifier: { assignee: null, assignment: '', signature: null },
    timestamp: 0,
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
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    for await (const graded of grader(source([]), correct, recover, 5, 0)) {
      collected.push(graded.grade.path);
    }
    expect(collected).toEqual([]);
    expect(correct).toHaveBeenCalledTimes(0);
  });

  it('yields all grades when all settle before drain', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: string[] = [];
    const correct = jest.fn(async (workbook: Headless) => grade(workbook));
    const stream = grader(source(paths), correct, jest.fn(), 5, 0);
    for await (const graded of stream) {
      collected.push(graded.grade.path);
    }
    expect(collected.sort()).toEqual(paths.slice().sort());
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });

  it('yields recovered grades for per-workbook failures', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: Certified[] = [];
    const correct = jest.fn(async (workbook: Headless) => {
      if (workbook.context.path === 'b.ipynb') {
        throw new Error('boom');
      }
      return grade(workbook);
    });
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream =  grader(source(paths), correct, recover, 2, 0);
      for await (const graded of stream) {
        collected.push(graded);
      }
    } finally {
      warn.mockRestore();
    }
    expect(collected.map(c => c.grade.path).sort()).toEqual(
      paths.slice().sort()
    );
    expect(recover).toHaveBeenCalledTimes(1);
    const b = collected.find(c => c.grade.path === 'b.ipynb')!;
    expect(b.grade.resolved).toBe(false);
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
      const stream = grader(source(paths), correct, jest.fn(), 0, 0);
      for await (const graded of stream) {
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
      const stream = grader(source(paths), correct, jest.fn(), 2, 0);
      for await (const graded of stream) {
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
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pending = (async () => {
        const stream = grader(source(paths), correct, recover, 3, 10);
        for await (const graded of stream) {
          collected.push(graded.grade.path);
        }
      })();
      await new Promise<void>(resolve => setTimeout(resolve, 50));
      await pending;
      expect(collected.sort()).toEqual(paths.slice().sort());
      expect(recover).toHaveBeenCalledTimes(paths.length);
      expect(
        warn.mock.calls.every(
          ([, , e]) => (e as Error).message === 'grader timeout'
        )
      ).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('yields recovered grades when all workbooks fail', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: Certified[] = [];
    const correct = jest.fn(async () => {
      throw new Error('boom');
    });
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream = grader(source(paths), correct, recover, 3, 0);
      for await (const graded of stream) {
        collected.push(graded);
      }
      expect(warn).toHaveBeenCalledTimes(paths.length);
    } finally {
      warn.mockRestore();
    }
    expect(collected.map(c => c.grade.path).sort()).toEqual(
      paths.slice().sort()
    );
    expect(collected.every(c => !c.grade.resolved)).toBe(true);
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });
});
