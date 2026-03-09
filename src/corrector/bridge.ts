import { useSyncExternalStore } from 'react';
import type { Scanned } from './commands';
import type { Workbook } from '../correxit';

type Collated = Map<
  string,
  { grade: Workbook.Grade; workbook: Workbook.Headless }
>;

export type Snapshot = Readonly<{
  workbooks: Scanned[];
  grades: Collated;
}>;

const empty: Snapshot = Object.freeze({ workbooks: [], grades: new Map() });
const listeners = new Set<() => void>();
let snapshot: Snapshot = empty;

function emit() {
  for (const listener of listeners) listener();
}

export function publish(next: Snapshot) {
  snapshot = next;
  emit();
}

export function clear() {
  publish(empty);
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
