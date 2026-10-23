import { PromiseDelegate } from '@lumino/coreutils';
import { Workbook } from '..';
import { grade as grader, Result } from '../corrector/grader';

type Certified = Workbook.Certified;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;
type Actions = {
  correct: (workbook: Headless) => Promise<Certified>;
  recover: (workbook: Headless) => Result.Failed;
};

const report = (result: Result): Grade =>
  result.ok ? result.certified.grade : result.grade;

const workbook = (path: string): Headless =>
  ({ context: { path } }) as unknown as Headless;

const grade = (workbook: Headless): Certified =>
  ({
    grade: {
      path: workbook.context.path,
      resolved: true,
      score: { status: 'unscored' },
      spec: null,
      verified: true
    },
    identifier: {
      assignee: 'a',
      assignment: 'x',
      file: workbook.context.path,
      issue: 'i',
      rubric: 'r'
    },
    workbook
  }) as unknown as Certified;

const failed = (workbook: Headless): Result.Failed => ({
  ok: false,
  grade: {
    path: workbook.context.path,
    resolved: false,
    score: { status: 'unscored' } as Grade['score'],
    spec: null,
    verified: false
  },
  workbook
});

const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const source = async function* (paths: string[]): AsyncGenerator<Headless> {
  for (const path of paths) {
    yield workbook(path);
  }
};

const actions = (
  correct: (workbook: Headless) => Promise<Certified>,
  recover: (workbook: Headless) => Result.Failed
): Actions => ({ correct, recover });

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
      collected.push(report(graded).path);
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
      collected.push(report(graded).path);
    }
    expect(collected.sort()).toEqual(paths.slice().sort());
    expect(correct).toHaveBeenCalledTimes(paths.length);
  });

  it('yields recovered grades for per-workbook failures', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: Result[] = [];
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
    expect(collected.map(c => report(c).path).sort()).toEqual(
      paths.slice().sort()
    );
    expect(recover).toHaveBeenCalledTimes(1);
    const b = collected.find(c => report(c).path === 'b.ipynb')!;
    expect(report(b).resolved).toBe(false);
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
        collected.push(report(graded).path);
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
        collected.push(report(graded).path);
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

  it('delivers a completed grade while the next scan read is blocked', async () => {
    const blocked = new PromiseDelegate<void>();
    const scanner = async function* () {
      yield workbook('a.ipynb');
      await blocked.promise;
      yield workbook('b.ipynb');
    };
    const correct = jest.fn(async (workbook: Headless) => grade(workbook));
    const stream = grader(scanner(), actions(correct, failed), 3);
    const first = await stream.next();
    expect(report(first.value as Result).path).toBe('a.ipynb');
    expect(correct).toHaveBeenCalledTimes(1);
    blocked.resolve();
    for await (const _ of stream) void _;
  });

  it('stops new jobs and retries while draining active work', async () => {
    const controller = new AbortController();
    const gate = new PromiseDelegate<void>();
    const correct = jest.fn(async (workbook: Headless) => {
      await gate.promise;
      if (workbook.context.path === 'a.ipynb') throw new Error('failure');
      return grade(workbook);
    });
    const recover = jest.fn(failed);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const results = (async () => {
      const output: Result[] = [];
      for await (const result of grader(
        source(['a.ipynb', 'b.ipynb', 'c.ipynb']),
        actions(correct, recover),
        2,
        2,
        controller.signal
      ))
        output.push(result);
      return output;
    })();
    await wait();
    expect(correct).toHaveBeenCalledTimes(2);
    controller.abort();
    gate.resolve();
    expect(await results).toHaveLength(2);
    expect(correct).toHaveBeenCalledTimes(2);
    expect(recover).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('waits for active work before closing an iterator', async () => {
    const first = new PromiseDelegate<void>();
    const second = new PromiseDelegate<void>();
    const correct = jest.fn(async (workbook: Headless) => {
      await (workbook.context.path === 'a.ipynb'
        ? first.promise
        : second.promise);
      return grade(workbook);
    });
    const stream = grader(
      source(['a.ipynb', 'b.ipynb', 'c.ipynb']),
      actions(correct, failed),
      2
    );
    const next = stream.next();
    await wait();
    expect(correct).toHaveBeenCalledTimes(2);
    first.resolve();
    await next;
    let closed = false;
    const closing = stream.return(undefined).then(() => {
      closed = true;
    });
    await wait();
    expect(closed).toBe(false);
    second.resolve();
    await closing;
    expect(correct).toHaveBeenCalledTimes(2);
  });

  it('drains active work when the scanner throws', async () => {
    const gate = new PromiseDelegate<void>();
    const scanner = async function* () {
      yield workbook('a.ipynb');
      throw new Error('scan failed');
    };
    const correct = jest.fn(async (workbook: Headless) => {
      await gate.promise;
      return grade(workbook);
    });
    const stream = grader(scanner(), actions(correct, failed), 2);
    const next = stream.next();
    const rejected = expect(next).rejects.toThrow('scan failed');
    await wait();
    expect(correct).toHaveBeenCalledTimes(1);
    gate.resolve();
    await rejected;
  });

  it('yields recovered grades when all workbooks fail', async () => {
    const paths = ['a.ipynb', 'b.ipynb', 'c.ipynb'];
    const collected: Result[] = [];
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
    expect(collected.map(c => report(c).path).sort()).toEqual(
      paths.slice().sort()
    );
    expect(collected.every(c => !report(c).resolved)).toBe(true);
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
    const collected: Result[] = [];
    try {
      const recover = jest.fn((workbook: Headless) => failed(workbook));
      const stream = grader(source(paths), actions(correct, recover), 3, 2);
      for await (const graded of stream) {
        collected.push(graded);
      }
    } finally {
      warn.mockRestore();
    }
    expect(collected.map(c => report(c).path).sort()).toEqual(
      paths.slice().sort()
    );
    expect(collected.every(c => report(c).resolved)).toBe(true);
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
    const collected: Result[] = [];
    try {
      const stream = grader(source(paths), actions(correct, recover), 2, 2);
      for await (const graded of stream) {
        collected.push(graded);
      }
    } finally {
      warn.mockRestore();
    }
    // a=1, b=3 (initial + 2 retries)
    expect(correct).toHaveBeenCalledTimes(1 + 3);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(
      report(collected.find(c => report(c).path === 'b.ipynb')!).resolved
    ).toBe(false);
  });
});
