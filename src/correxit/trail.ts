import { IRenderMime } from '@jupyterlab/rendermime';
import { Rubric } from './rubric';

type TranslationBundle = IRenderMime.TranslationBundle;

/** @returns chronological assignment lifecycle entries for display. */
export function trail(
  assignment: Rubric.Assignment,
  trans: TranslationBundle
): string[] {
  const { certification, collected, distribution, submission, submitted } =
    assignment;
  const lines: string[] = [];
  if (distribution !== null)
    lines.push(trans.__('Distribution %1', Rubric.timestamp(distribution)));
  if (submission !== null)
    lines.push(trans.__('Submission %1', Rubric.timestamp(submission)));
  if (submitted !== null) lines.push(trans.__('Submitted: %1', submitted));
  if (certification !== null)
    lines.push(trans.__('Certification %1', Rubric.timestamp(certification)));
  if (collected !== null) lines.push(trans.__('Collected: %1', collected));
  return lines;
}
