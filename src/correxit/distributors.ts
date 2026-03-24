import { Correxit } from '.';

/** Manual distribution is a no-op. */
export async function manual(
  _propagated: Parameters<Correxit.Distributor>[0]
): Promise<void> {}
