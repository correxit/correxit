import { Notebook, Submitter } from '@correxit/contracts';
import * as security from './security';

/** Content-addressed digest receipt for a submitted workbook. */
export async function manual(
  submitted: Submitter.Payload
): Promise<string> {
  const { identifier, notebook, submission } = submitted;
  const { assignee, issue, rubric: id } = identifier;
  const collapse = ({ id, source }: Notebook.Cell) =>
    [id, Array.isArray(source) ? source.join('') : source];
  const sources = notebook.cells
    .map(collapse)
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  const payload = JSON.stringify({
    assignee,
    issue,
    rubric: id,
    sources,
    submission
  });
  return `manual:${await security.digest(payload)}`;
}
