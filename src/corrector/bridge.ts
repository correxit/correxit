import { CommandRegistry } from '@lumino/commands';
import { useSyncExternalStore } from 'react';
import { Corrector } from '.';
import type { Scanned } from './commands';

type Collated = Corrector.Collated;

export type Cursor = { path: string; cell: string };

export type Snapshot = Readonly<{
  cursor: Cursor | null;
  workbooks: Scanned[];
  grades: Collated;
}>;

const empty: Snapshot = Object.freeze({
  cursor: null,
  workbooks: [],
  grades: new Map()
});
const listeners = new Set<() => void>();
let snapshot: Snapshot = empty;

function emit() {
  for (const listener of listeners) listener();
}

export function publish(next: Omit<Snapshot, 'cursor'>) {
  snapshot = { ...next, cursor: snapshot.cursor };
  emit();
}

export function navigate(cursor: Snapshot['cursor']) {
  snapshot = { ...snapshot, cursor };
  emit();
}

export function clear() {
  snapshot = empty;
  emit();
}

/**
 * Inject a workbook into the monitor stream.
 *
 * The `correxit:inject` command returns a single-emission
 * function. Subsequent calls after the first are no-ops.
 */
export function inject(commands: CommandRegistry, workbook: unknown) {
  void (async () => (await commands.execute('correxit:inject'))?.(workbook))();
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
