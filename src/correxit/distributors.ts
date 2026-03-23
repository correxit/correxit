import { Correxit } from '.';

/** Manual distribution records a trivial local receipt. */
export async function manual(
  _propagated: Parameters<Correxit.Distributor>[0]
): Promise<string> {
  return 'manual';
}
