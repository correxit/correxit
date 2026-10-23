import type { Workbook } from '..';
import { pool } from './pool';

export type Mode = 'scan' | 'grade' | 'collect';
export type File = { grade: Workbook.Grade; workbook: Workbook.Headless };
export type Event =
  | { type: 'listed'; paths: string[] }
  | {
      type: 'read';
      path: string;
      workbook: Workbook.Headless | null;
      error: string | null;
    }
  | { type: 'started'; path: string }
  | { type: 'result'; path: string; file: File; changed: boolean }
  | { type: 'error'; path: string | null; message: string }
  | { type: 'done'; stopped: boolean };

export type Actions = {
  list: () => Promise<string[]>;
  read: (path: string) => Promise<Workbook.Headless | null>;
  perform: (
    workbook: Workbook.Headless
  ) => Promise<{ file: File; changed: boolean }>;
};

/** One discovery pass supplies both the table and the bounded processing jobs. */
export async function* run(
  actions: Actions,
  options: { mode: Mode; cap: number; retries: number; signal: AbortSignal }
): AsyncGenerator<Event> {
  const { mode, cap, retries, signal } = options;
  let paths: string[];
  try {
    paths = await actions.list();
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
          workbook = await actions.read(path);
        } catch {
          yield { type: 'read', path, workbook: null, error: 'read' };
          return;
        }
        yield { type: 'read', path, workbook, error: null };
        if (!workbook || mode === 'scan' || signal.aborted) return;
        yield { type: 'started', path };
        // A stop between the read and started emissions must not start work.
        if (signal.aborted) return;
        for (let attempt = 0; ; attempt++) {
          try {
            const { file, changed } = await actions.perform(workbook);
            yield { type: 'result', path, file, changed };
            return;
          } catch {
            if (attempt < retries && !signal.aborted) continue;
            yield {
              type: 'error',
              path,
              message: mode === 'grade' ? 'grade' : 'sync'
            };
            return;
          }
        }
      })();
    }
  };
  yield* pool(jobs(), mode === 'scan' ? 1 : cap, signal);
  yield { type: 'done', stopped: signal.aborted };
}
