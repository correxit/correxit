import { IRenderMime } from '@jupyterlab/rendermime';
import { Rubric } from '.';
import { Workbook } from './workbook';

type Grade = Workbook.Grade;
type TranslationBundle = IRenderMime.TranslationBundle;

const ID = 'correxit-workbook-certificate';

/** Append or replace the certificate markdown cell in a certified workbook. */
export function render(
  workbook: Workbook,
  grade: Grade,
  trans: TranslationBundle
): void {
  const rubric = Workbook.open(workbook, true);
  if (!rubric) return;

  const { assignee, certification, name, report, signature } =
    rubric.assignment;

  const notebook = workbook.context.model.sharedModel;
  const cells = notebook.cells;
  const ordered = cells
    .map(({ id }) => id)
    .filter(id => Rubric.has(rubric, id));
  const preview = Object.fromEntries(cells.map(cell => {
    const line = cell.getSource().split('\n')[0];
    return [cell.id, line.length > 40 ? line.slice(0, 40) + '\u2026' : line];
  }));
  const status = (status: Rubric.Score.Status) =>
    status === 'correct' ? '\u2705'
    : status === 'incorrect' ? '\u274c'
    : status === 'partial' ? '\u26a0\ufe0f'
    : '\u2014';
  const lines: string[] = [
    '---',
    '',
    `## ${trans.__('Certificate')}`,
    '',
    '| | |',
    '|---|---|',
    `| **${trans.__('Assignee')}** | ${assignee} |`,
    `| **${trans.__('Assignment')}** | ${name} |`,
    `| **${trans.__('Score')}** | ${grade.score.points}` +
      ` / ${grade.score.possible} |`,
    `| **${trans.__('Certified')}** | ${Rubric.timestamp(certification, 'n/a')} |`,
    `| **${trans.__('Signature')}** | \`${signature}\` |`,
    ''
  ];
  if (ordered.length) {
    lines.push(
      `| ${trans.__('Cell')} | ${trans.__('Type')}` +
        ` | ${trans.__('Score')} | ${trans.__('Status')}` +
        ` | ${trans.__('Comment')} |`,
      '|---|---|---|---|---|'
    );
    for (const id of ordered) {
      const cell = Rubric.get(rubric, id)!;
      const scored = Rubric.Score.resolve(report, id);
      const points = scored
        ? `${scored.points} / ${scored.possible}`
        : '\u2014';
      const comment = scored?.comment || '';
      lines.push(
        `| \`${preview[id] || id}\` | ${cell.is}` +
          ` | ${points}` +
          ` | ${status(scored?.status ?? 'unscored')}` +
          ` | ${comment} |`
      );
    }
    lines.push('');
  }

  const source = lines.join('\n');
  const metadata = { editable: false, trusted: true };
  const existing = cells.findIndex(cell => cell.id === ID);
  notebook.transact(() => {
    if (existing !== -1) notebook.deleteCell(existing);
    notebook.insertCell(existing !== -1 ? existing : cells.length, {
      cell_type: 'markdown',
      id: ID,
      metadata,
      source
    });
  }, false);
}
