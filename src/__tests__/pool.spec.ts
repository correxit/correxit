import { PromiseDelegate } from '@lumino/coreutils';
import { pool } from '../corrector/pool';

const wait = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('pool', () => {
  it('delivers a completed job while the next source read is blocked', async () => {
    const gate = new PromiseDelegate<void>();
    const source = async function* () {
      yield (async function* () {
        yield 'a';
      })();
      await gate.promise;
      yield (async function* () {
        yield 'b';
      })();
    };
    const stream = pool(source(), 2);
    try {
      expect(await stream.next()).toEqual({ done: false, value: 'a' });
    } finally {
      gate.resolve();
      await stream.return(undefined);
    }
  });

  it('waits for an active job before closing without pulling more work', async () => {
    const first = new PromiseDelegate<void>();
    const gate = new PromiseDelegate<void>();
    const started: string[] = [];
    const finished: string[] = [];
    const source = async function* () {
      for (const path of ['a', 'b', 'c']) {
        yield (async function* () {
          started.push(path);
          try {
            if (path === 'a') await first.promise;
            if (path === 'b') await gate.promise;
            yield path;
          } finally {
            finished.push(path);
          }
        })();
      }
    };
    const stream = pool(source(), 2);
    const next = stream.next();
    await wait();
    first.resolve();
    expect(await next).toEqual({ done: false, value: 'a' });
    let closed = false;
    const closing = stream.return(undefined).then(() => {
      closed = true;
    });
    try {
      await wait();
      expect(started).toEqual(['a', 'b']);
      expect(closed).toBe(false);
    } finally {
      gate.resolve();
      await closing;
    }
    expect(started).toEqual(['a', 'b']);
    expect(finished.sort()).toEqual(['a', 'b']);
  });

  it('drains an active job when the source throws', async () => {
    const gate = new PromiseDelegate<void>();
    let finished = false;
    const source = async function* () {
      yield (async function* () {
        try {
          await gate.promise;
          yield 'a';
        } finally {
          finished = true;
        }
      })();
      throw new Error('read failed');
    };
    const stream = pool(source(), 2);
    const rejected = expect(stream.next()).rejects.toThrow('read failed');
    try {
      await wait();
      expect(finished).toBe(false);
    } finally {
      gate.resolve();
      await rejected;
    }
    expect(finished).toBe(true);
  });
});
