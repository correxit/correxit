import { Collector } from '@correxit/contracts';
import * as security from './security';

/** Content-addressed digest receipt for a certified workbook grade. */
export async function manual(payload: Collector.Payload): Promise<string> {
  const { certification, identifier, score: { points, possible } } = payload;
  const { assignee, issue, rubric: id } = identifier;
  const terms = JSON.stringify({
    assignee,
    certification,
    issue,
    points,
    possible,
    rubric: id
  });
  return `manual:${await security.digest(terms)}`;
}
