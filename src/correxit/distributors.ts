import { Correxit } from '.';

/** Manual distribution is a no-op. */
export async function manual(
  _payload: Parameters<Correxit.Distributor>[0]
): Promise<boolean> { return true; }
