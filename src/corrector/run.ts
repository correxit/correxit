import type { Workbook } from '..';
import * as Error from '../correxit/error';
import { pool } from './pool';

export type Mode = Run['mode'];
export type File = { grade: Workbook.Grade; workbook: Workbook.Headless };
export type Diagnostic =
  | 'directory'
  | 'read'
  | 'authenticate'
  | 'invalid'
  | 'grade'
  | 'sync';
export type Event =
  | { type: 'listed'; paths: string[] }
  | {
      type: 'read';
      path: string;
      workbook: Workbook.Headless | null;
      error: 'read' | null;
    }
  | { type: 'started'; path: string }
  | { type: 'result'; path: string; file: File; completed: boolean }
  | { type: 'error'; path: string | null; message: Diagnostic }
  | { type: 'done'; stopped: boolean };

export type Run = {
  list: () => Promise<string[]>;
  read: (path: string) => Promise<Workbook.Headless | null>;
  signal: AbortSignal;
} & (
  | { mode: 'scan' }
  | {
      mode: 'grade';
      grade: (workbook: Workbook.Headless) => Promise<File>;
      cap: number;
      retries: number;
    }
  | {
      mode: 'collect';
      collect: (workbook: Workbook.Headless) => Promise<{
        file: File;
        completed: boolean;
      }>;
    }
);

/** One discovery pass supplies both the table and the bounded processing jobs. */
export async function* run(run: Run): AsyncGenerator<Event> {
  const { signal } = run;
  if (signal.aborted) {
    yield { type: 'done', stopped: true };
    return;
  }
  let paths: string[];
  try {
    paths = await run.list();
  } catch {
    yield { type: 'error', path: null, message: 'directory' };
    yield { type: 'done', stopped: signal.aborted };
    return;
  }
  yield { type: 'listed', paths };
  const jobs = async function* () {
    for (const path of paths) {
      if (signal.aborted) return;
      yield (async function* (): AsyncGenerator<Event> {
        let workbook: Workbook.Headless | null;
        try {
          workbook = await run.read(path);
        } catch {
          yield { type: 'read', path, workbook: null, error: 'read' };
          return;
        }
        yield { type: 'read', path, workbook, error: null };
        if (!workbook || run.mode === 'scan' || signal.aborted) return;
        yield { type: 'started', path };
        // Each yield lets the consumer stop before the next operation starts.
        if (signal.aborted) return;
        for (let attempt = 0; ; attempt++) {
          try {
            const { file, completed } =
              run.mode === 'grade'
                ? { file: await run.grade(workbook), completed: true }
                : await run.collect(workbook);
            yield { type: 'result', path, file, completed };
            return;
          } catch (error) {
            const message = diagnostic(error, run.mode);
            if (
              run.mode === 'grade' &&
              message === 'grade' &&
              attempt < run.retries &&
              !signal.aborted
            )
              continue;
            yield { type: 'error', path, message };
            return;
          }
        }
      })();
    }
  };
  yield* pool(jobs(), run.mode === 'grade' ? run.cap : 1, signal);
  yield { type: 'done', stopped: signal.aborted };
}

/** Preserve the failure category without exposing credentials or notebook contents. */
function diagnostic(error: unknown, mode: 'grade' | 'collect'): Diagnostic {
  if (
    error instanceof Error.Decrypt ||
    error instanceof Error.Unlock ||
    error instanceof Error.Unseal ||
    error instanceof Error.Mismatch
  )
    return 'authenticate';
  if (error instanceof Error.Invalid) return 'invalid';
  return mode === 'grade' ? 'grade' : 'sync';
}
