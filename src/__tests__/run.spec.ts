import { PromiseDelegate } from '@lumino/coreutils';
import type { Workbook } from '..';
import { Actions, Event, run } from '../corrector/run';

const workbook = (path: string) => ({ context: { path } }) as Workbook.Headless;
const file = (workbook: Workbook.Headless) => ({
  workbook,
  grade: {
    path: workbook.context.path,
    verified: true,
    resolved: true,
    score: { status: 'correct', points: 1, possible: 1 },
    spec: null
  } as Workbook.Grade
});
const actions = (): Actions => ({
  list: jest.fn(async () => ['a', 'b', 'c']),
  read: jest.fn(async path => workbook(path)),
  perform: jest.fn(async workbook => ({ file: file(workbook), changed: true }))
});
const options = (controller = new AbortController()) => ({
  mode: 'grade' as const,
  cap: 2,
  retries: 2,
  signal: controller.signal
});
const collect = async (stream: AsyncIterable<Event>) => {
  const events: Event[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

describe('Corrector run', () => {
  it('is cold, lists once, and reads each source exactly once', async () => {
    const tasks = actions();
    const stream = run(tasks, options());
    expect(tasks.list).not.toHaveBeenCalled();
    const events = await collect(stream);
    expect(tasks.list).toHaveBeenCalledTimes(1);
    expect(tasks.read).toHaveBeenCalledTimes(3);
    expect(tasks.perform).toHaveBeenCalledTimes(3);
    expect(events.filter(event => event.type === 'result')).toHaveLength(3);
    expect(events[events.length - 1]).toEqual({ type: 'done', stopped: false });
  });

  it('emits results while another read remains blocked', async () => {
    const tasks = actions();
    const gate = new PromiseDelegate<void>();
    tasks.read = jest.fn(async path => {
      if (path === 'b') await gate.promise;
      return workbook(path);
    });
    const stream = run(tasks, options());
    let result: Event | null = null;
    for await (const event of stream) {
      if (event.type === 'result') {
        result = event;
        gate.resolve();
        break;
      }
    }
    expect(result).toMatchObject({ type: 'result', path: 'a' });
  });

  it('skips ordinary notebooks and reports read and processing failures', async () => {
    const tasks = actions();
    tasks.read = jest.fn(async path => {
      if (path === 'a') return null;
      if (path === 'b') throw new Error('private details');
      return workbook(path);
    });
    tasks.perform = jest.fn(async () => {
      throw new Error('private credential');
    });
    const events = await collect(run(tasks, options()));
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
    expect(tasks.perform).toHaveBeenCalledTimes(3);
  });

  it('never processes a read that finishes after Stop', async () => {
    const tasks = actions();
    const controller = new AbortController();
    const stream = run(tasks, options(controller));
    for await (const event of stream) {
      if (event.type === 'read') controller.abort();
    }
    expect(tasks.perform).not.toHaveBeenCalled();
  });

  it('reports directory failures without exposing their contents', async () => {
    const tasks = actions();
    tasks.list = jest.fn(async () => {
      throw new Error('secret');
    });
    expect(await collect(run(tasks, options()))).toEqual([
      { type: 'error', path: null, message: 'directory' },
      { type: 'done', stopped: false }
    ]);
  });
});
