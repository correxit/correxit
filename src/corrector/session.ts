import { CommandRegistry } from '@lumino/commands';
import { useSyncExternalStore } from 'react';
import type { Workbook } from '..';
import type { Scanned } from './commands';
import type { Diagnostic, Event, File, Mode } from './run';

export type Cursor = { path: string; cell: string };

export type Entry = Readonly<{
  workbook: Scanned;
  grade: Workbook.Grade | null;
  phase: 'queued' | 'processing' | 'scanned' | 'failed';
  error: Diagnostic | null;
}>;

export type Progress = Readonly<{
  total: number;
  checked: number;
  completed: number;
  finished: number;
  skipped: number;
  failed: number;
  listed: boolean;
  done: boolean;
  stopped: boolean;
  error: boolean;
}>;

export type Snapshot = Readonly<{
  run: string | null;
  mode: Mode;
  cursor: Cursor | null;
  entries: ReadonlyMap<string, Entry>;
  progress: Progress;
}>;

export const empty: Snapshot = {
  run: null,
  mode: 'scan',
  cursor: null,
  entries: new Map(),
  progress: {
    total: 0,
    checked: 0,
    completed: 0,
    finished: 0,
    skipped: 0,
    failed: 0,
    listed: false,
    done: false,
    stopped: false,
    error: false
  }
};
const listeners = new Set<() => void>();
let snapshot = empty;

function update(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Commands own the displayed run, including its results after completion. */
export function begin(run: string, mode: Mode) {
  update({ ...empty, run, mode });
}

export function clear(run: string) {
  if (snapshot.run === run) update(empty);
}

/** Apply each event once, before yielding it to the command's caller. */
export function advance(run: string, event: Event) {
  if (snapshot.run !== run) return;
  const entries = new Map(snapshot.entries);
  const progress = { ...snapshot.progress };
  if (event.type === 'listed') {
    progress.listed = true;
    progress.total = event.paths.length;
    for (const path of event.paths) {
      entries.set(path, {
        workbook: { hollow: true, context: { path } },
        grade: null,
        phase: 'queued',
        error: null
      });
    }
  } else if (event.type === 'read') {
    progress.checked++;
    if (event.workbook) {
      entries.set(event.path, {
        workbook: event.workbook,
        grade: null,
        phase: 'scanned',
        error: null
      });
    } else if (event.error) {
      entries.set(event.path, {
        ...entries.get(event.path)!,
        phase: 'failed',
        error: event.error
      });
      progress.finished++;
      progress.failed++;
    } else {
      entries.delete(event.path);
      progress.skipped++;
      progress.finished++;
    }
  } else if (event.type === 'started') {
    entries.set(event.path, {
      ...entries.get(event.path)!,
      phase: 'processing'
    });
  } else if (event.type === 'result') {
    entries.set(event.path, {
      ...event.file,
      phase: event.file.grade.resolved ? 'scanned' : 'failed',
      error: null
    });
    progress.finished++;
    if (event.completed) progress.completed++;
    else progress.skipped++;
    if (!event.file.grade.resolved) progress.failed++;
  } else if (event.type === 'error') {
    progress.failed++;
    if (event.path) {
      entries.set(event.path, {
        ...entries.get(event.path)!,
        grade: null,
        phase: 'failed',
        error: event.message
      });
      progress.finished++;
    } else {
      progress.error = true;
    }
  } else if (event.type === 'done') {
    progress.done = true;
    progress.stopped = event.stopped;
  }
  update({ ...snapshot, entries, progress });
}

/** Review replaces the current result; it never reconciles with an old run. */
export function record(file: File) {
  const path = file.workbook.context.path;
  const entry = snapshot.entries.get(path);
  if (entry?.workbook !== file.workbook) return;
  update({
    ...snapshot,
    entries: new Map(snapshot.entries).set(path, { ...entry, ...file })
  });
}

/** Processing contexts become reviewable only after their operation settles. */
export function available({ entries, mode, progress }: Snapshot) {
  return Array.from(entries.values()).filter(
    (entry): entry is Entry & { workbook: Workbook.Headless } =>
      !entry.workbook.hollow &&
      (mode === 'scan' || progress.done || entry.grade !== null)
  );
}

export function navigate(cursor: Cursor | null) {
  update({ ...snapshot, cursor });
}

/** Select a workbook in the shared notebook monitor. */
export function inject(commands: CommandRegistry, workbook: unknown) {
  void (async () => (await commands.execute('correxit:inject'))?.(workbook))();
}

export function peek(): Snapshot {
  return snapshot;
}

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(callback => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }, peek);
}
