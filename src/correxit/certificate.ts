import type { Collector } from '@correxit/contracts';
import { IRenderMime } from '@jupyterlab/rendermime';
import { JSONExt } from '@lumino/coreutils';
import { Rubric } from '.';
import { Certify } from './error';
import { Workbook } from './workbook';

type Grade = Workbook.Grade;
type TranslationBundle = IRenderMime.TranslationBundle;

const ID = 'correxit-workbook-certificate';
const { has, timestamp } = Rubric;

/** Remove the score report when a certified workbook becomes editable. */
export function remove(workbook: Workbook): void {
  const notebook = workbook.context.model.sharedModel;
  const index = notebook.cells.findIndex(cell => cell.id === ID);
  if (index !== -1) notebook.deleteCell(index);
}

const locked = (workbook: Workbook): Rubric.Locked | null => {
  if (workbook.context.isDisposed) return null;
  const rubric = Workbook.open(workbook, true);
  const notebook = workbook.context.model.sharedModel;
  return rubric?.locked && JSONExt.deepEqual(
    notebook.getMetadata('correxit') ?? null, rubric
  ) ? rubric : null;
};

/** Rebuild feedback from a current, authenticated grade. */
export function restore(
  certified: Workbook.Certified,
  trans: TranslationBundle
): Workbook.Certified {
  const { grade, rubric, revision, workbook } = certified;
  if (locked(workbook) !== rubric || Workbook.revision(workbook) !== revision)
    throw new Certify('certify error: workbook changed');
  render(workbook, grade, trans);
  return { ...certified, revision: Workbook.revision(workbook) };
}

/** Record a collection receipt and refresh the returned workbook's feedback. */
export async function record(
  certified: Workbook.Certified,
  collector: Collector,
  trans: TranslationBundle
): Promise<boolean> {
  const { grade, rubric, workbook } = certified;
  if (!await Workbook.record(certified, collector)) return false;
  const current = locked(workbook);
  if (!current || current.id !== rubric.id || current.assignment.collected === null ||
    current.assignment.certification !== rubric.assignment.certification ||
    current.assignment.report !== rubric.assignment.report) return false;
  render(workbook, grade, trans);
  return true;
}

/** Append or replace the score report cell and freeze the certified workbook. */
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
  if (typeof collected === 'string')
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
    for (const cell of notebook.cells) cell.setMetadata('editable', false);
  }, false);
}
