import { Collector } from '@correxit/contracts';
import * as security from './security';

/** Content-addressed digest receipt for a certified workbook grade. */
export async function manual(certified: Collector.Payload): Promise<string> {
  const { certification, identifier, points, possible } = certified;
  const { assignee, issue, rubric: id } = identifier;
  const payload = JSON.stringify({
    assignee,
    certification,
    issue,
    points,
    possible,
    rubric: id
  });
  return `manual:${await security.digest(payload)}`;
}
