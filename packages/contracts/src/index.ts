import { Token } from '@lumino/coreutils';

/**
 * Stable correlation identity for a workbook state.
 */
export type Identifier = {
  assignee: string | null;
  assignment: string | null;
  file: string | null;
  issue: string | null;
  rubric: string;
};

export namespace Identifier {
  /** An identifier with guaranteed assignee and file paths. */
  export type Assigned = Identifier & {
    assignee: string;
    file: string;
  };

  /** Type guard for assigned identifiers. */
  export function assigned(id: Identifier): id is Assigned {
    return typeof id.assignee === 'string' && typeof id.file === 'string';
  }
}

/**
 * Structural JSON representation of a Jupyter notebook document.
 */
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
    id?: string;
    metadata: Record<string, unknown>;
    source: string | string[];
    [key: string]: unknown;
  };
}

/**
 * Sidecar resource file required by a workbook.
 */
export type Resource = {
  data: Uint8Array;
  name: string;
};

/**
 * Symmetric key or passphrase credentials.
 */
export type Secret =
  | { key: string; passphrase: null }
  | { key: null; passphrase: string };

/**
 * Assignment registration metadata provided by a registrar.
 */
export type Registration = {
  expiration: number | null;
  id: string | null;
  name: string;
  roster: string[];
};

export namespace Registration {
  /** A named group or course of registrations. */
  export type Group = {
    assignments: Registration[];
    group: string;
  };
}

/**
 * Collector of certified workbook grades.
 */
export type Collector = (
  certified: Collector.Payload
) => Promise<string | null>;

export namespace Collector {
  export type Score = {
    code: string;
    comment: string;
    points: number;
    possible: number;
    status: string;
  };

  export type Payload = {
    certification: number | null;
    file: string;
    identifier: Identifier.Assigned;
    name: string;
    notebook: Notebook;
    path: string;
    points: number;
    possible: number;
    score: Score;
  };
}

export const COLLECTOR = 'correxit:collector';
export const Collector = new Token<Collector>(COLLECTOR);

/**
 * Distributor of propagated workbooks to students or external destinations.
 */
export type Distributor = (propagated: Distributor.Payload) => Promise<boolean>;

export namespace Distributor {
  export type Payload = {
    identifier: Identifier.Assigned;
    notebook: Notebook;
    overwrite: boolean;
    path: string;
    resources: Resource[] | null;
  };
}

export const DISTRIBUTOR = 'correxit:distributor';
export const Distributor = new Token<Distributor>(DISTRIBUTOR);

/**
 * Provider of available assignment registrations.
 */
export type Registrar = (
  identifier: Identifier
) => Promise<Registration[] | Registration.Group[] | null>;

export const REGISTRAR = 'correxit:registrar';
export const Registrar = new Token<Registrar>(REGISTRAR);

/**
 * Receiver of submitted workbooks returning an external receipt.
 */
export type Submitter = (
  submitted: Submitter.Payload
) => Promise<string | null>;

export namespace Submitter {
  export type Payload = {
    file: string;
    identifier: Identifier.Assigned;
    name: string;
    notebook: Notebook;
    path: string;
    submission: number | null;
  };
}

export const SUBMITTER = 'correxit:submitter';
export const Submitter = new Token<Submitter>(SUBMITTER);

/**
 * Key custody provider for acquiring credentials and persisting author keys.
 */
export type Unlocker = {
  /**
   * Lazily yield candidate secrets for the given request.
   * For unlock, Correxit pulls until one authenticates. Other purposes consume
   * the first yielded choice; finish any required custody before yielding it.
   * Yielding null proceeds without a secret (fire-and-forget submit, or reset).
   * Ending without a usable secret cancels the operation.
   */
  request(request: Unlocker.Request): AsyncIterable<Secret | null>;

  /** Persist an author key associated with a rubric id. */
  store(rubric: string, key: string): Promise<void>;
};

export namespace Unlocker {
  export type Purpose = 'create' | 'submit' | 'revise' | 'recover' | 'unlock';

  export type Request = {
    identifier: Identifier | null;
    path: string;
    purpose: Purpose;
    silent: boolean;
  };
}

export const UNLOCKER = 'correxit:unlocker';
export const Unlocker = new Token<Unlocker>(UNLOCKER);
