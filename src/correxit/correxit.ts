import { INotebookContent } from '@jupyterlab/nbformat';
import { Token } from '@lumino/coreutils';
import { Rubric, Workbook } from '.';
import { commands as COMMANDS, CommandIDs as COMMAND_IDS } from './commands';
import * as description from './description';
import { Icons as ICONS } from './icons';

export namespace Correxit {
  /** A collector of certified workbook grades. */
  export type Collector = (
    certified: Workbook.Certified
  ) => Promise<string | null>;

  export type Consumer = (output: {
    path: string;
    rubric: Rubric.Unlocked;
    stream: Propagator;
  }) => AsyncGenerator<Emitter.Emission>;

  /** A message emitter for notifications and other Correxit UI updates. */
  export type Emitter = AsyncIterable<Emitter.Emission>;

  export namespace Emitter {
    /** An emission with slots to populate interpolations. */
    export type Emission = { slots: (string | number)[]; type: string; };
  }

  /** Connects/disconnects workbooks and yields them to plugins. */
  export type Monitor = AsyncIterable<Workbook | null>;

  /** An async propagator of assigned workbook content. */
  export type Propagator = (location: { base: string; pwd: string }) =>
    Promise<AsyncIterable<Propagator.Notebook>>;

  export namespace Propagator {
    export type Notebook = {
      identifier: Workbook.Identifier.Assigned;
      notebook: INotebookContent;
      path: string;
    };
  }

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
  ) => Promise<Rubric.Assignment.Registration[] | null>;

  export type Injector = (workbook: Workbook | null) => void;

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

  export const CONSUMER = '@quantstack/correxit:consumer';

  export const Consumer = new Token<Consumer>(CONSUMER);

  export const CORRECTOR = '@quantstack/correxit:corrector';

  export const DESCRIPTION = {
    COLLECTOR: description.COLLECTOR,
    CONSUMER: description.CONSUMER,
    CORRECTOR: description.CORRECTOR,
    MONITOR: description.MONITOR,
    REGISTRAR: description.REGISTRAR,
    SUBMITTER: description.SUBMITTER,
    UI: description.UI,
    UNLOCKER: description.UNLOCKER
  };

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
