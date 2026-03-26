import { INotebookContent } from '@jupyterlab/nbformat';
import { Token } from '@lumino/coreutils';
import { Rubric, Workbook } from '.';
import { commands as COMMANDS, CommandIDs as COMMAND_IDS } from './commands';
import * as description from './description';
import * as error from './error';
import { Icons as ICONS } from './icons';

export namespace Correxit {
  /** A collector of certified workbook grades. */
  export type Collector = (
    certified: Workbook.Certified
  ) => Promise<string | null>;

  export type Distributor = (propagated: {
    identifier: Workbook.Identifier.Assigned;
    notebook: INotebookContent;
    path: string;
  }) => Promise<void>;

  export type Injector = (workbook: Workbook | null) => void;

  /** Connects/disconnects workbooks and yields them to plugins. */
  export type Monitor = AsyncIterable<Workbook | null>;

  /**
    * A registrar that provides assignment registrations for a workbook.
   *
   * #### Notes
    * If the returned registrations are null, assignment input is unlocked.
    * If registrations are empty or populated, assignment input is locked.
   */
  export type Registrar = (
    workbook: Workbook,
    identifier: Workbook.Identifier
  ) => Promise<
    | Rubric.Assignment.Registration[]
    | { group: string; assignments: Rubric.Assignment.Registration[] }[]
    | null
  >;

  export type Submitter = (
    workbook: Workbook,
    identifier: Workbook.Identifier.Assigned
  ) => Promise<string | null>;

  export type Unlocker = {
    /** Store the key for a given rubric id. */
    store(id: string, key: string): Promise<void>;

    /** Unlock a given workbook with the given credentials. */
    unlock(
      workbook: Workbook,
      credentials: Partial<Workbook.Credentials & { silent: boolean }> | null
    ): Promise<Rubric.Unlocked | null>;
  };

  export const COLLECTOR = '@quantstack/correxit:collector';

  export const Collector = new Token<Collector>(COLLECTOR);

  export const CommandIDs = COMMAND_IDS;

  export const commands = COMMANDS;

  export const DISTRIBUTOR = '@quantstack/correxit:distributor';

  export const Distributor = new Token<Distributor>(DISTRIBUTOR);

  export const CORRECTOR = '@quantstack/correxit:corrector';

  export const DESCRIPTION = {
    COLLECTOR: description.COLLECTOR,
    DISTRIBUTOR: description.DISTRIBUTOR,
    CORRECTOR: description.CORRECTOR,
    MONITOR: description.MONITOR,
    REGISTRAR: description.REGISTRAR,
    SUBMITTER: description.SUBMITTER,
    UI: description.UI,
    UNLOCKER: description.UNLOCKER
  };

  export namespace Error {
    export import Decrypt   = error.Decrypt;
    export import Encrypt   = error.Encrypt;
    export import Seal      = error.Seal;
    export import Unseal    = error.Unseal;
    export import Mismatch  = error.Mismatch;
    export import Invalid   = error.Invalid;
    export import Certify   = error.Certify;
    export import Lock      = error.Lock;
    export import Submit    = error.Submit;
    export import Revise    = error.Revise;
    export import Unlock    = error.Unlock;
    export import Save      = error.Save;
    export import Fetch     = error.Fetch;
    export import Plugin    = error.Plugin;
    export import interpret = error.interpret;
    export import reason    = error.reason;
  }

  export const Icons = ICONS;

  export const MONITOR = '@quantstack/correxit:monitor';

  export const Monitor = new Token<Monitor>(MONITOR);

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const REGISTRAR = '@quantstack/correxit:registrar';

  export const Registrar = new Token<Registrar>(REGISTRAR);

  export const SUBMITTER = '@quantstack/correxit:submitter';

  export const Submitter = new Token<Correxit.Submitter>(SUBMITTER);

  export const TOOLBARS = '@quantstack/correxit:toolbars';

  export const UI = '@quantstack/correxit:ui';

  export const UNLOCKER = '@quantstack/correxit:unlocker';

  export const Unlocker = new Token<Unlocker>(UNLOCKER);
}
