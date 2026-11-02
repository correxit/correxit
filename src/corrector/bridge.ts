import { CommandRegistry } from '@lumino/commands';
import { useSyncExternalStore } from 'react';
import { Corrector } from '.';
import type { Scanned } from './commands';
import type { File } from './run';

type Collated = Corrector.Collated;

export type Cursor = { path: string; cell: string };

export type Snapshot = Readonly<{
  cursor: Cursor | null;
  grades: Collated;
  revision: number;
  workbooks: Scanned[];
}>;

const empty: Snapshot = Object.freeze({
  cursor: null,
  grades: new Map(),
  revision: 0,
  workbooks: []
});
const listeners = new Set<() => void>();
let snapshot: Snapshot = empty;

export function clear() {
  snapshot = empty;
  emit();
}

function emit() {
  for (const listener of listeners) listener();
}

/**
 * Inject a workbook into the monitor stream.
 *
 * ### Notes
 * This invokes the `correxit:inject` command, which updates the monitor with
 * the given workbook, which notifies relevant commands, etc.
 */
export function inject(commands: CommandRegistry, workbook: unknown) {
  void (async () => (await commands.execute('correxit:inject'))?.(workbook))();
}

export function navigate(cursor: Snapshot['cursor']) {
  snapshot = { ...snapshot, cursor };
  emit();
}

export function peek(): Snapshot {
  return snapshot;
}

export function publish(next: Omit<Snapshot, 'cursor' | 'revision'>) {
  const grades = merge(next.workbooks, next.grades, snapshot.grades);
  if (
    next.workbooks.length === snapshot.workbooks.length &&
    next.workbooks.every(
      (workbook, index) => workbook === snapshot.workbooks[index]
    ) &&
    grades.size === snapshot.grades.size &&
    Array.from(grades).every(
      ([path, file]) => snapshot.grades.get(path) === file
    )
  )
    return;
  snapshot = {
    ...next,
    grades,
    cursor: snapshot.cursor,
    revision: snapshot.revision
  };
  emit();
}

/** Keep command results only while their exact workbook context is retained. */
export function merge(
  workbooks: Scanned[],
  grades: Collated,
  previous: Collated
): Collated {
  return new Map(
    workbooks.flatMap(workbook => {
      const { path } = workbook.context;
      const current = previous.get(path);
      const file = current?.workbook === workbook ? current : grades.get(path);
      return file ? [[path, file] as const] : [];
    })
  );
}

/** Publish a saved review result, or invalidate its score while saving. */
export function record(file: File) {
  if (!snapshot.workbooks.includes(file.workbook)) return;
  snapshot = {
    ...snapshot,
    grades: new Map(snapshot.grades).set(file.workbook.context.path, file)
  };
  touch();
}

export function touch() {
  snapshot = { ...snapshot, revision: snapshot.revision + 1 };
  emit();
}

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(
    callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => snapshot
  );
}
