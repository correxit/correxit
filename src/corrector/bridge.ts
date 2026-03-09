import { useSyncExternalStore } from 'react';
import { Corrector } from '.';
import type { Scanned } from './commands';

type Collated = Corrector.Collated;

export type Snapshot = Readonly<{
  cursor: { path: string; cell: string } | null;
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

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(
    callback => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => snapshot
  );
}
