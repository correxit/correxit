import { PromiseDelegate } from '@lumino/coreutils';
import type { Workbook } from '..';
import * as Error from '../correxit/error';
import { Event, File, Run, run } from '../corrector/run';

const workbook = (path: string) => ({ context: { path } }) as Workbook.Headless;
const file = (workbook: Workbook.Headless): File => ({
  workbook,
  grade: {
    path: workbook.context.path,
    verified: true,
    resolved: true,
    score: {
      status: 'correct',
      points: 1,
      possible: 1,
      code: '',
      comment: '',
      id: ''
    },
    spec: null
  }
});
const batch = (controller = new AbortController()) =>
  ({
    mode: 'grade' as const,
    list: jest.fn(async () => ['a', 'b', 'c']),
    read: jest.fn(
      async (path: string): Promise<Workbook.Headless | null> => workbook(path)
    ),
    grade: jest.fn(async (workbook: Workbook.Headless) => file(workbook)),
    cap: 2,
    retries: 2,
    signal: controller.signal
  }) satisfies Run;
const collect = async (stream: AsyncIterable<Event>) => {
  const events: Event[] = [];
  for await (const event of stream) events.push(event);
  return events;
};
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('Corrector run', () => {
  it('is cold, lists once, and reads each source exactly once', async () => {
    const tasks = batch();
    const stream = run(tasks);
    expect(tasks.list).not.toHaveBeenCalled();
    const events = await collect(stream);
    expect(tasks.list).toHaveBeenCalledTimes(1);
    expect(tasks.read).toHaveBeenCalledTimes(3);
    expect(tasks.grade).toHaveBeenCalledTimes(3);
    expect(events.filter(event => event.type === 'result')).toHaveLength(3);
    expect(events[events.length - 1]).toEqual({ type: 'done', stopped: false });
  });

  it('finishes an empty directory without reading or grading', async () => {
    const tasks = batch();
    tasks.list.mockResolvedValue([]);
    expect(await collect(run(tasks))).toEqual([
      { type: 'listed', paths: [] },
      { type: 'done', stopped: false }
    ]);
    expect(tasks.read).not.toHaveBeenCalled();
    expect(tasks.grade).not.toHaveBeenCalled();
  });

  it('scans without a grading or collection operation', async () => {
    const { list, read, signal } = batch();
    const events = await collect(run({ mode: 'scan', list, read, signal }));
    expect(events.map(event => event.type)).toEqual([
      'listed',
      'read',
      'read',
      'read',
      'done'
    ]);
  });

  it('emits results while another read remains blocked', async () => {
    const tasks = batch();
    const gate = new PromiseDelegate<void>();
    tasks.read.mockImplementation(async path => {
      if (path === 'b') await gate.promise;
      return workbook(path);
    });
    let result: Event | null = null;
    for await (const event of run(tasks)) {
      if (event.type === 'result') {
        result = event;
        gate.resolve();
        break;
      }
    }
    expect(result).toMatchObject({ type: 'result', path: 'a' });
  });

  it.each([0, 2])('bounds reading and grading with cap %i', async cap => {
    const tasks = batch();
    tasks.cap = cap;
    const gates = Object.fromEntries(
      ['a', 'b', 'c'].map(path => [path, new PromiseDelegate<void>()])
    );
    tasks.grade.mockImplementation(async workbook => {
      await gates[workbook.context.path].promise;
      return file(workbook);
    });
    const pending = collect(run(tasks));
    try {
      await wait();
      expect(tasks.read).toHaveBeenCalledTimes(Math.max(1, cap));
      expect(tasks.grade).toHaveBeenCalledTimes(Math.max(1, cap));
      gates.a.resolve();
      await wait();
      expect(tasks.read).toHaveBeenCalledTimes(Math.max(1, cap) + 1);
      expect(tasks.grade).toHaveBeenCalledTimes(Math.max(1, cap) + 1);
    } finally {
      Object.values(gates).forEach(gate => gate.resolve());
    }
    const events = await pending;
    expect(events.filter(event => event.type === 'result')).toHaveLength(3);
  });

  it('skips ordinary notebooks and reports read and processing failures safely', async () => {
    const tasks = batch();
    tasks.read.mockImplementation(async path => {
      if (path === 'a') return null;
      if (path === 'b') throw new globalThis.Error('private details');
      return workbook(path);
    });
    tasks.grade.mockRejectedValue(new globalThis.Error('private credential'));
    const events = await collect(run(tasks));
    expect(events).toContainEqual({
      type: 'read',
      path: 'a',
      workbook: null,
      error: null
    });
    expect(events).toContainEqual({
      type: 'read',
      path: 'b',
      workbook: null,
      error: 'read'
    });
    expect(events).toContainEqual({
      type: 'error',
      path: 'c',
      message: 'grade'
    });
    expect(JSON.stringify(events)).not.toContain('private');
    expect(tasks.grade).toHaveBeenCalledTimes(3);
  });

  it('retries grading failures without rereading or announcing another start', async () => {
    const tasks = batch();
    tasks.list.mockResolvedValue(['a']);
    tasks.grade
      .mockRejectedValueOnce(new globalThis.Error('kernel failed'))
      .mockRejectedValueOnce(new globalThis.Error('kernel failed'));
    const events = await collect(run(tasks));
    expect(tasks.read).toHaveBeenCalledTimes(1);
    expect(tasks.grade).toHaveBeenCalledTimes(3);
    expect(events.map(event => event.type)).toEqual([
      'listed',
      'read',
      'started',
      'result',
      'done'
    ]);
  });

  it.each([
    [Error.Decrypt, 'authenticate'],
    [Error.Unlock, 'authenticate'],
    [Error.Unseal, 'authenticate'],
    [Error.Mismatch, 'authenticate'],
    [Error.Invalid, 'invalid']
  ] as const)(
    'does not retry %p failures or expose their details',
    async (Failure, message) => {
      const tasks = batch();
      tasks.list.mockResolvedValue(['a']);
      tasks.grade.mockRejectedValue(new Failure('private credential'));
      const events = await collect(run(tasks));
      expect(tasks.grade).toHaveBeenCalledTimes(1);
      expect(events).toContainEqual({ type: 'error', path: 'a', message });
      expect(JSON.stringify(events)).not.toContain('private');
      expect(events.some(event => event.type === 'result')).toBe(false);
    }
  );

  it('collects serially, preserves skipped results, and never retries delivery', async () => {
    const { list, read, signal } = batch();
    const gate = new PromiseDelegate<void>();
    const sync = jest.fn(async (workbook: Workbook.Headless) => {
      if (workbook.context.path === 'a') await gate.promise;
      if (workbook.context.path === 'b')
        throw new globalThis.Error('private receipt');
      return { file: file(workbook), completed: workbook.context.path !== 'c' };
    });
    const pending = collect(
      run({ mode: 'collect', list, read, signal, collect: sync })
    );
    try {
      await wait();
      expect(read).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve();
    }
    const events = await pending;
    expect(sync).toHaveBeenCalledTimes(3);
    expect(events).toContainEqual({
      type: 'error',
      path: 'b',
      message: 'sync'
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'result',
        path: 'c',
        completed: false
      })
    );
    expect(JSON.stringify(events)).not.toContain('private');
  });

  it.each(['read', 'started'])(
    'does not start grading when stopped after %s',
    async type => {
      const controller = new AbortController();
      const tasks = batch(controller);
      for await (const event of run(tasks)) {
        if (event.type === type) controller.abort();
      }
      expect(tasks.grade).not.toHaveBeenCalled();
    }
  );

  it('does not list a directory when stopped before the first pull', async () => {
    const controller = new AbortController();
    const tasks = batch(controller);
    controller.abort();
    expect(await collect(run(tasks))).toEqual([
      { type: 'done', stopped: true }
    ]);
    expect(tasks.list).not.toHaveBeenCalled();
  });

  it('drains active grades after Stop without new reads or retries', async () => {
    const controller = new AbortController();
    const tasks = batch(controller);
    const gate = new PromiseDelegate<void>();
    tasks.grade.mockImplementation(async workbook => {
      await gate.promise;
      if (workbook.context.path === 'a')
        throw new globalThis.Error('kernel failed');
      return file(workbook);
    });
    const pending = collect(run(tasks));
    try {
      await wait();
      expect(tasks.grade).toHaveBeenCalledTimes(2);
      controller.abort();
    } finally {
      gate.resolve();
    }
    const events = await pending;
    expect(tasks.read).toHaveBeenCalledTimes(2);
    expect(tasks.grade).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual({
      type: 'error',
      path: 'a',
      message: 'grade'
    });
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'result', path: 'b' })
    );
    expect(events[events.length - 1]).toEqual({ type: 'done', stopped: true });
  });

  it('reports directory failures without exposing their contents', async () => {
    const tasks = batch();
    tasks.list.mockRejectedValue(new globalThis.Error('secret'));
    expect(await collect(run(tasks))).toEqual([
      { type: 'error', path: null, message: 'directory' },
      { type: 'done', stopped: false }
    ]);
  });
});
