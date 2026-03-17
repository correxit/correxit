import { ICell } from '@jupyterlab/nbformat';
import { Workbook } from '.';
import * as security from './security';

/** Content-addressed digest receipt for a submitted workbook. */
export async function manual(
  workbook: Workbook,
  identifier: Workbook.Identifier.Assigned
): Promise<string> {
  const { assignee, rubric: id, signature } = identifier;
  const rubric = Workbook.open(workbook, true);
  const submission = rubric?.assignment.submission ?? null;
  const notebook = workbook.context.model.sharedModel.toJSON();
  const collapse = ({ id, source }: ICell) =>
    [id, Array.isArray(source) ? source.join('') : source];
  const sources = notebook.cells
    .map(collapse).sort(([a], [b]) => String(a).localeCompare(String(b)));
  const payload = JSON.stringify({
    assignee, rubric: id, signature, sources, submission
  });
  return `manual:${await security.digest(payload)}`;
}
