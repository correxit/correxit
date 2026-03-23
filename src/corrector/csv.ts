import { Rubric, Workbook } from '..';
import type { Scanned } from './commands';

type Grade = Workbook.Grade;
type Headless = Workbook.Headless;

export function generate(
  workbooks: readonly Scanned[],
  grades: ReadonlyMap<string, { grade: Grade }>
): string {
  const { summary } = Rubric.Assignment;
  const identity = ['assignee', 'assignment', 'expiration', 'title', 'rubric'];
  const resolution = ['issue', 'points', 'possible'];
  const lifecycle = ['submission', 'submitted', 'certification', 'collected'];
  const diagnostic = ['resolved', 'path'];
  const header = [...identity, ...resolution, ...lifecycle, ...diagnostic];
  const reified = workbooks.filter(workbook => !workbook.hollow);
  const rows = reified.map(workbook => {
    const rubric = Workbook.open(workbook as Headless, true);
    const path = workbook.context.path;
    const grade = grades.get(path)?.grade ?? null;
    const assignee = rubric?.assignment.assignee || '';
    const assignment = rubric?.assignment.id || '';
    const title = rubric?.assignment.name || '';
    const issue = rubric?.assignment.issue || '';
    const { points, possible, status } =
      grade?.score ??
      (rubric ? summary(rubric.assignment.report) : null) ??
      Rubric.Score.UNSCORED;
    const expiration = rubric?.assignment.expiration ?? null;
    const submission = rubric?.assignment.submission ?? null;
    const submitted = rubric?.assignment.submitted ?? null;
    const certification = rubric?.assignment.certification ?? null;
    const collected = rubric?.assignment.collected ?? null;
    const resolved = grade?.resolved ?? false;
    const unscored = status === 'unscored';
    return [
      assignee,
      assignment,
      Rubric.timestamp(expiration),
      title,
      rubric?.id || '',
      issue,
      unscored ? '' : String(points),
      unscored ? '' : String(possible),
      Rubric.timestamp(submission),
      submitted ?? '',
      Rubric.timestamp(certification),
      collected ?? '',
      String(resolved),
      path
    ];
  });
  const body = [header, ...rows]
    .map(row => row.map(escape).join(','))
    .join('\r\n');
  return '\uFEFF' + body;
}

function escape(field: string) {
  const safe = /^[=+\-@\t\r]/.test(field) ? `'${field}` : field;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
