import { Rubric, Workbook } from '.';

const state: {
  report: { [cached: string]: Rubric.Score };
  workbook: Workbook | null;
} = {
  report: Object.create(null),
  workbook: null
};

/**
 * @returns the cached score for a cell or the persisted score when uncached.
 */
export function report(
  workbook: Workbook | null,
  id: string,
  score: Rubric.Score | null = null
): Rubric.Score | null {
  const rubric = Workbook.open(workbook, true);
  if (!rubric) {
    return null;
  }

  const cached = `${rubric.id}:${rubric.assignment.assignee || ''}:${id}`;
  return score
    ? state.report[cached] = score
    : state.report[cached] || rubric.assignment.report.scores[id] || null;
}

/**
 * @returns the active workbook and updates cache if given a workbook.
 */
export function workbook(update?: Workbook | null): Workbook | null {
  return state.workbook = update ?? state.workbook;
}

/**
 * @returns the resolved cell id from command arguments.
 */
export function cell(args: Partial<
  Rubric.Cell & Rubric.Cell.Toolbar
>): Rubric.Cell['id'] {
  const notebook = workbook()?.content;
  const toolbar = args[Rubric.Cell.TOOLBAR];
  return args.id || toolbar && notebook?.activeCell?.model.id || '';
}
