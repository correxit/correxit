import { PromiseDelegate } from '@lumino/coreutils';
import { Workbook } from '..';
import { grader } from '../corrector/grader';

type Certified = Workbook.Certified;
type Headless = Workbook.Headless;
type Actions = {
  correct: (workbook: Headless) => Promise<Certified>;
  exclude: (workbook: Headless) => Certified | null;
  recover: (workbook: Headless) => Certified;
};

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
    workbook
  }) as unknown as Certified;

const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const source = async function* (paths: string[]): AsyncGenerator<Headless> {
  for (const path of paths) {
    yield workbook(path);
  }
};

const actions = (
  correct: (workbook: Headless) => Promise<Certified>,
  recover: (workbook: Headless) => Certified,
  exclude: (workbook: Headless) => Certified | null = () => null
): Actions => ({ correct, exclude, recover });

describe('grader', () => {
  it('yields nothing for an empty scan', async () => {
    const collected: string[] = [];
    const correct = jest.fn(async (workbook: Headless) => grade(workbook));
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    for await (const graded of grader(
      source([]),
      actions(correct, recover),
      5
    )) {
      collected.push(graded.grade.path);
    }
    expect(collected).toEqual([]);
    expect(correct).toHaveBeenCalledTimes(0);
  });

  it('yields all grades when all settle before drain', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: string[] = [];
    const correct = jest.fn(async (workbook: Headless) => grade(workbook));
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    const stream = grader(source(paths), actions(correct, recover), 5);
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
      const stream = grader(source(paths), actions(correct, recover), 2);
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
      const recover = jest.fn((workbook: Headless) => failed(workbook));
      const stream = grader(source(paths), actions(correct, recover), 0);
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
      const recover = jest.fn((workbook: Headless) => failed(workbook));
      const stream = grader(source(paths), actions(correct, recover), 2);
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

  it('yields recovered grades when all workbooks fail', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: Certified[] = [];
    const correct = jest.fn(async () => {
      throw new Error('boom');
    });
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const stream = grader(source(paths), actions(correct, recover), 3);
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

  it('retries transient failures before resolving', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const calls: Record<string, number> = Object.fromEntries(
      paths.map(p => [p, 0])
    );
    const correct = jest.fn(async (workbook: Headless) => {
      calls[workbook.context.path]++;
      if (workbook.context.path === 'b.ipynb' && calls['b.ipynb'] < 3) {
        throw new Error('transient');
      }
      return grade(workbook);
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const collected: Certified[] = [];
    try {
      const recover = jest.fn((workbook: Headless) => failed(workbook));
      const stream = grader(source(paths), actions(correct, recover), 3, 2);
      for await (const graded of stream) {
        collected.push(graded);
      }
    } finally {
      warn.mockRestore();
    }
    expect(collected.map(c => c.grade.path).sort()).toEqual(
      paths.slice().sort()
    );
    expect(collected.every(c => c.grade.resolved)).toBe(true);
    expect(calls['b.ipynb']).toBe(3); // failed twice, resolved on 3rd try
    expect(correct).toHaveBeenCalledTimes(paths.length + 2);
  });

  it('recovers workbooks that exhaust all retries', async () => {
    const paths = ['a.ipynb', 'b.ipynb'];
    const correct = jest.fn(async (workbook: Headless) => {
      if (workbook.context.path === 'b.ipynb') throw new Error('persistent');
      return grade(workbook);
    });
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const collected: Certified[] = [];
    try {
      const stream = grader(source(paths), actions(correct, recover), 2, 2);
      for await (const graded of stream) {
        collected.push(graded);
      }
    } finally {
      warn.mockRestore();
    }
    expect(correct).toHaveBeenCalledTimes(1 + 3); // a=1, b=3 (initial + 2 retries)
    expect(recover).toHaveBeenCalledTimes(1);
    expect(
      collected.find(c => c.grade.path === 'b.ipynb')!.grade.resolved
    ).toBe(false);
  });

  it('emits skipped workbooks immediately without grading them', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: string[] = [];
    const correct = jest.fn(async (workbook: Headless) => grade(workbook));
    const recover = jest.fn((workbook: Headless) => failed(workbook));
    const skip = jest.fn((workbook: Headless) =>
      workbook.context.path === 'a.ipynb' ? grade(workbook) : null
    );

    const stream = grader(source(paths), actions(correct, recover, skip), 2);
    for await (const graded of stream) {
      collected.push(graded.grade.path);
    }

    expect(collected).toContain('a.ipynb');
    expect(correct).toHaveBeenCalledTimes(2);
    expect(correct).not.toHaveBeenCalledWith(
      expect.objectContaining({ context: { path: 'a.ipynb' } })
    );
  });
});
