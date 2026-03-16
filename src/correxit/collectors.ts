import { Workbook } from '.';
import * as security from './security';

/** Content-addressed digest receipt for a certified workbook grade. */
export async function manual(certified: Workbook.Certified): Promise<string> {
  const { grade, identifier } = certified;
  const { points, possible } = grade.score;
  const { assignee, rubric: id, signature } = identifier;
  const rubric = Workbook.open(certified.workbook, true);
  const certification = rubric?.assignment.certification ?? null;
  const payload = JSON.stringify({
    assignee, certification, points, possible, rubric: id, signature
  });
  return security.digest(payload);
}
