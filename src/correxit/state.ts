import { ISignal, Signal } from '@lumino/signaling';
import { Rubric, Workbook } from '.';

const signal = new Signal<object, void>({});
const guard = ({ content: notebook }: Workbook.Headed) => {
  if (notebook.notebookConfig.showEditorForReadOnlyMarkdown !== false) {
    notebook.notebookConfig = {
      ...notebook.notebookConfig,
      showEditorForReadOnlyMarkdown: false
    };
  }
};
const state: {
  cursor: string | null;
  report: Map<string, Rubric.Score>;
  workbook: Workbook | null;
} = { cursor: null, report: new Map(), workbook: null };

/** Upper bound for in-memory cache of cell scores. */
export const LIMIT = 500;

/** Notifies that the UI needs to be refreshed. */
export const refreshed: ISignal<object, void> = signal;

/**
 * Caches a cell score in memory.
 *
 * #### Notes
 * Enables UI components to display correction results (e.g., cell decorations)
 * across re-renders and tab switches. For locked workbooks, this is the only
 * storage mechanism since scores cannot be persisted to rubric metadata.
 */
export function cache(workbook: Workbook, id: string, score: Rubric.Score) {
  const rubric = Workbook.open(workbook, true);
  if (!rubric) return;

  const key = `${rubric.id}:${rubric.assignment.assignee || ''}:${id}`;
  if (!state.report.has(key) && state.report.size >= LIMIT)
    state.report.delete(state.report.keys().next().value!); // FIFO eviction
  state.report.set(key, score);
}

/** @returns the resolved cell id from command arguments. */
export function cell(args: Partial<Rubric.Cell & Rubric.Cell.Toolbar>): string {
  const active = workbook();
  const notebook = Workbook.headed(active) ? active.content : null;
  const toolbar = args[Rubric.Cell.TOOLBAR];
  return args.id || (toolbar && notebook?.activeCell?.model.id) || '';
}

/** @returns the active reviewer cursor cell ID; caches the update if given. */
export function cursor(update?: string | null): string | null {
  if (update !== undefined && update !== state.cursor) {
    state.cursor = update;
    refresh();
  }
  return state.cursor;
}

/** Notify the sidebar to re-render. */
export function refresh() {
  signal.emit(undefined);
}

/** @returns the cached or persisted score for a cell. */
export function report(
  workbook: Workbook | null,
  id: string
): Rubric.Score | null {
  const rubric = Workbook.open(workbook, true);
  if (!rubric || !workbook) return null;

  const key = `${rubric.id}:${rubric.assignment.assignee || ''}:${id}`;
  const cached = state.report.get(key);
  if (cached) return cached;

  const score = Rubric.Score.resolve(rubric.assignment.report, id);
  if (score) cache(workbook, id, score);
  return score;
}

/** @returns the active workbook; caches the update if given. */
export function workbook(update?: Workbook | null): Workbook | null {
  state.workbook = update === undefined ? state.workbook : update;
  const active = state.workbook;
  if (Workbook.headed(active)) guard(active);
  return state.workbook;
}
