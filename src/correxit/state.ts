import { Rubric, Workbook } from '.';

const state: {
  report: Map<string, Rubric.Score>;
  workbook: Workbook | null;
} = { report: new Map(), workbook: null };

/**
 * The maximum number of cached cell score reports.
 */
export const footprint = 1000;

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
  if (!rubric) {
    return;
  }

  const key = `${rubric.id}:${rubric.assignment.assignee || ''}:${id}`;
  if (!state.report.has(key) && state.report.size >= footprint) {
    state.report.delete(state.report.keys().next().value!); // FIFO eviction
  }
  state.report.set(key, score);
}

/**
 * @returns the resolved cell id from command arguments.
 */
export function cell(args: Partial<Rubric.Cell & Rubric.Cell.Toolbar>): string {
  const notebook = workbook()?.content;
  const toolbar = args[Rubric.Cell.TOOLBAR];
  return args.id || toolbar && notebook?.activeCell?.model.id || '';
}


/**
 * @returns the cached score for a cell or the persisted score when uncached.
 */
export function report(workbook: Workbook | null, id: string
): Rubric.Score | null {
  const rubric = Workbook.open(workbook, true);
  if (!rubric || !workbook) {
    return null;
  }

  const key = `${rubric.id}:${rubric.assignment.assignee || ''}:${id}`;
  const cached = state.report.get(key);
  if (cached) {
    return cached;
  }

  const score = rubric.assignment.report.scores[id] || null;
  if (score) {
    cache(workbook, id, score);
  }
  return score;
}

/**
 * @returns the active workbook and updates cache if given a workbook.
 */
export function workbook(update?: Workbook | null): Workbook | null {
  if (update !== undefined) {
    state.workbook = update;
  }
  return state.workbook;
}
