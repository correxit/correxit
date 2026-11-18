import { Token } from '@lumino/coreutils';

/** Identifies a workbook state across provider calls. */
export type Identifier = {
  /** The registrar-provided assignee. */
  assignee: string | null;
  /** An external assignment ID. */
  assignment: string | null;
  /** The file basename. */
  file: string | null;
  /** The issued-content digest. */
  issue: string | null;
  /** The workbook's rubric ID. */
  rubric: string;
};

export namespace Identifier {
  /** An identifier with non-null assignee and file basename. */
  export type Assigned = Identifier & { assignee: string; file: string };

  /** Type guard for assigned identifiers. */
  export function assigned(id: Identifier): id is Assigned {
    return typeof id.assignee === 'string' && typeof id.file === 'string';
  }
}

/** Structural JSON representation of a Jupyter notebook document. */
export type Notebook = {
  cells: Notebook.Cell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
  [key: string]: unknown;
};

export namespace Notebook {
  export type Cell = {
    cell_type: string;
    /** Though optional in nbformat; Correxit requires IDs before issuance. */
    id?: string;
    metadata: Record<string, unknown>;
    source: string | string[];
    [key: string]: unknown;
  };
}

/** Sidecar resource file required by a workbook. */
export type Resource = { data: Uint8Array; name: string };

/**
 * Supply exactly one credential, with the other field explicitly null.
 * Keys are 256-bit values encoded as 64 lowercase hexadecimal characters.
 * Correxit derives passphrase keys using the rubric ID as salt.
 */
export type Secret =
  | { key: string; passphrase: null }
  | { key: null; passphrase: string };

/** Assignment registration metadata provided by a registrar. */
export type Registration = {
  /** Deadline in milliseconds since the Unix epoch, or null for none. */
  expiration: number | null;
  id: string | null;
  name: string;
  roster: string[];
};

export namespace Registration {
  /** A named group or course of registrations. */
  export type Group = { assignments: Registration[]; group: string };
}

/**
 * Receive an authenticated, certified grade. Return an opaque receipt or null
 * when collection was not recorded; throw to report a failure. Calls may be
 * retried, so providers should avoid duplicate external records. Correxit
 * stores the receipt as assignment.collected.
 */
export type Collector = (payload: Collector.Payload) => Promise<string | null>;

export namespace Collector {
  export type Score = {
    /** Diagnostic code; consumers should tolerate unrecognized values. */
    code: string;
    comment: string;
    points: number;
    possible: number;
    /** Score status; consumers should tolerate unrecognized values. */
    status: string;
  };

  export type Payload = {
    /** Local certification time in milliseconds since the Unix epoch. */
    certification: number;
    identifier: Identifier.Assigned;
    /** Assignment display name. */
    name: string;
    notebook: Notebook;
    /** Jupyter contents path of the workbook. */
    path: string;
    score: Score;
  };
}

export const COLLECTOR = 'correxit:collector';
export const Collector = new Token<Collector>(COLLECTOR);

/**
 * Deliver one personalized notebook. Return true to save it locally and record
 * distribution, or false to skip it. A failure is reported and Correxit still
 * attempts a local save without recording distribution. Calls may be retried.
 */
export type Distributor = (payload: Distributor.Payload) => Promise<boolean>;

export namespace Distributor {
  export type Payload = {
    identifier: Identifier.Assigned;
    notebook: Notebook;
    /** True when the author explicitly requests re-delivery. */
    overwrite: boolean;
    /** Intended destination in Jupyter contents. */
    path: string;
    /** Null when no sidecar resources were declared. */
    resources: Resource[] | null;
  };
}

export const DISTRIBUTOR = 'correxit:distributor';
export const Distributor = new Token<Distributor>(DISTRIBUTOR);

/**
 * Offer assignment registrations for an authoring workbook. Return null to
 * permit manual entry, an empty array for no eligible assignments, or a flat
 * or grouped list of registrations.
 */
export type Registrar = (
  identifier: Identifier
) => Promise<Registration[] | Registration.Group[] | null>;

export const REGISTRAR = 'correxit:registrar';
export const Registrar = new Token<Registrar>(REGISTRAR);

/**
 * Receive a sealed submission. Return an opaque receipt or null when delivery
 * was not recorded; throw to report a failure. Correxit stores the receipt as
 * assignment.submitted. Calls may be retried; the local submission timestamp
 * does not prove on-time delivery to an external service.
 */
export type Submitter = (payload: Submitter.Payload) => Promise<string | null>;

export namespace Submitter {
  export type Payload = {
    identifier: Identifier.Assigned;
    /** Assignment display name. */
    name: string;
    notebook: Notebook;
    /** Jupyter contents path of the workbook. */
    path: string;
    /** Local sealing time in milliseconds since the Unix epoch. */
    submission: number;
  };
}

export const SUBMITTER = 'correxit:submitter';
export const Submitter = new Token<Submitter>(SUBMITTER);

/** Key custody provider for requesting credentials and storing author keys. */
export type Unlocker = {
  /**
   * Supply credentials lazily for the requested operation.
   *
   * `unlock` tries candidates until one authenticates, ignoring `null`.
   * Other purposes consume only the first yielded value:
   * - `create` and `revise` require a secret.
   * - `submit` accepts `null` to submit without revision access.
   * - `recover` accepts `null` to reset without recovering encrypted sources.
   *
   * End the iterable before a choice is accepted to cancel. When `silent` is
   * true, supply available credentials without opening UI.
   *
   * Complete any required credential storage before yielding, including
   * student credentials retained for revision. Correxit closes the iterator
   * after accepting a choice, so code after the yield may never run.
   */
  request(request: Unlocker.Request): AsyncIterable<Secret | null>;

  /**
   * Store an author key by rubric ID, before creation commits or after a
   * successful unlock. Student credentials never pass through this method.
   */
  store(rubric: string, key: string): Promise<void>;
};

export namespace Unlocker {
  export type Purpose = 'create' | 'submit' | 'revise' | 'recover' | 'unlock';

  export type Request = {
    path: string;
    silent: boolean;
  } & (
    | {
        /** Proposed identity; creation may still be cancelled or fail. */
        identifier: Identifier;
        purpose: 'create';
      }
    | {
        identifier: Identifier | null;
        purpose: Exclude<Purpose, 'create'>;
      }
  );
}

export const UNLOCKER = 'correxit:unlocker';
export const Unlocker = new Token<Unlocker>(UNLOCKER);
