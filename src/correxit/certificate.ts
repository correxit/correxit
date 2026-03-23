import { IRenderMime } from '@jupyterlab/rendermime';
import { Rubric } from '.';
import { Workbook } from './workbook';

type Grade = Workbook.Grade;
type TranslationBundle = IRenderMime.TranslationBundle;

const ID = 'correxit-workbook-certificate';
const { has, timestamp } = Rubric;

/** Append or replace the score report cell in a certified workbook. */
export function render(
  workbook: Workbook,
  grade: Grade,
  trans: TranslationBundle
): void {
  const rubric = Workbook.open(workbook, true);
  if (!rubric) return;

  const {
    assignee, certification, collected, name,
    report, submission, submitted
  } = rubric.assignment;

  const notebook = workbook.context.model.sharedModel;
  const cells = notebook.cells;
  const ordered = cells.map(({ id }) => id).filter(id => has(rubric, id));
  const position = Object.fromEntries(
    cells.map(({ id }, index) => [id, index + 1])
  );
  const preview = Object.fromEntries(cells.map(cell => {
    const line = cell.getSource().split('\n').find(line => line.trim()) ?? '';
    const trimmed = line.trim();
    return [cell.id, trimmed.length > 40
      ? trimmed.slice(0, 40) + '\u2026' : trimmed];
  }));
  const icon = (status: Rubric.Score.Status) =>
    status === 'correct' ? '\u2705'
    : status === 'incorrect' ? '\u274c'
    : status === 'partial' ? '\u26a0\ufe0f'
    : '--';
  const lines: string[] = [
    '---',
    '',
    `## ${trans.__('Score Report')}`,
    '',
    '| | |',
    '|---|---|',
    `| **${trans.__('Assignee')}** | ${assignee} |`,
    `| **${trans.__('Assignment')}** | ${name} |`,
    `| **${trans.__('Score')}** | ${grade.score.points}` +
      ` / ${grade.score.possible} |`,
  ];
  if (submission) {
    lines.push(`| **${trans.__('Submitted')}** | ${timestamp(submission)} |`);
    if (submitted)
      lines.push(`| **${trans.__('Receipt')}** | \`${submitted}\` |`);
  }
  lines.push(
    `| **${trans.__('Certified')}** | ${timestamp(certification, 'n/a')} |`
  );
  if (collected)
    lines.push(`| **${trans.__('Collected')}** | \`${collected}\` |`);
  if (grade.spec)
    lines.push(`| **${trans.__('Kernel')}** | ${grade.spec.display_name} |`);
  lines.push('');
  if (ordered.length) {
    lines.push(
      `| # | ${trans.__('Cell')} | ${trans.__('Type')}` +
         ` | ${trans.__('Score')} | ${trans.__('Status')}` +
         ` | ${trans.__('Comment')} |`,
      '|--:|---|---|---|---|---|'
    );
    for (const id of ordered) {
      const cell = Rubric.get(rubric, id)!;
      const scored = Rubric.Score.resolve(report, id);
      const points = scored ? `${scored.points} / ${scored.possible}` : '–';
      const comment = scored?.comment || '';
      lines.push(
        `| ${position[id]}` +
          ` | \`${preview[id] || id}\`` +
          ` | ${cell.is}` +
          ` | ${points}` +
          ` | ${icon(scored?.status ?? 'unscored')}` +
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
