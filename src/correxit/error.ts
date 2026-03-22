import { IRenderMime } from '@jupyterlab/rendermime';

// Crypto layer
export class Decrypt extends Error { name = 'Decrypt' as const; }
export class Encrypt extends Error { name = 'Encrypt' as const; }
export class Seal    extends Error { name = 'Seal'    as const; }
export class Unseal  extends Error { name = 'Unseal'  as const; }

// Integrity layer
export class Mismatch extends Error { name = 'Mismatch' as const; }
export class Invalid  extends Error { name = 'Invalid'  as const; }

// Lifecycle layer
export class Certify extends Error { name = 'Certify' as const; }
export class Lock    extends Error { name = 'Lock'    as const; }
export class Submit  extends Error { name = 'Submit'  as const; }
export class Revise  extends Error { name = 'Revise'  as const; }
export class Unlock  extends Error { name = 'Unlock'  as const; }

// IO layer (plugins, filesystem, network)
export class Save   extends Error { name = 'Save'   as const; }
export class Fetch  extends Error { name = 'Fetch'  as const; }
export class Plugin extends Error { name = 'Plugin' as const; }

/** Translate an error into a localized [title, body] pair. */
export function interpret(
  error: unknown,
  trans: IRenderMime.TranslationBundle
): [string, Error] {
  const body = error instanceof Error ? error : new Error(String(error));
  switch (body.name) {
    case 'Decrypt':  return [trans.__('Decryption failed'), body];
    case 'Encrypt':  return [trans.__('Encryption failed'), body];
    case 'Seal':     return [trans.__('Could not seal'), body];
    case 'Unseal':   return [trans.__('Could not unseal'), body];
    case 'Mismatch': return [trans.__('Integrity mismatch'), body];
    case 'Invalid':  return [trans.__('Invalid workbook'), body];
    case 'Certify':  return [trans.__('Could not certify'), body];
    case 'Lock':     return [trans.__('Could not lock'), body];
    case 'Submit':   return [trans.__('Could not submit'), body];
    case 'Revise':   return [trans.__('Could not revise'), body];
    case 'Unlock':   return [trans.__('Could not unlock'), body];
    case 'Save':     return [trans.__('Could not save'), body];
    case 'Fetch':    return [trans.__('Could not fetch'), body];
    case 'Plugin':   return [trans.__('Plugin error'), body];
    default:         return [trans.__('Unexpected error'), body];
  }
}
