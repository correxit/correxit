import { INotebookContent } from '@jupyterlab/nbformat';
import { Token } from '@lumino/coreutils';
import { Rubric, Workbook } from '.';
import { CommandIDs as COMMAND_IDS } from './commands';
import * as description from './description';
import { Icons as ICONS } from './icons';

export namespace Correxit {
  /**
   * A collector of certified workbook grades.
   */
  export type Collector = (
    grades: AsyncIterable<Workbook.Certified> | Iterable<Workbook.Certified>
  ) => AsyncGenerator<Workbook.Certified>;

  export type Consumer = (output: {
    log: Emitter.Log;
    path: string;
    rubric: Rubric.Unlocked;
    stream: Propagator;
  }) => Promise<void>;

  /**
   * A message emitter for notifications and other Correxit UI updates.
   */
  export type Emitter = AsyncIterable<{ payload: Emitter.Emission }>;

  export namespace Emitter {
    /**
     * A notification/message emission with slots to populate interpolations.
     */
    export type Emission = { slots: (string | number)[]; type: string; };

    /**
     * A logging function wired for UI updates for clients to invoke.
     */
    export type Log = (payload: Emitter.Emission) => Promise<void>;
  }

  /**
   * An async propagator of assigned workbook content.
   */
  export type Propagator = (location: { base: string; pwd: string }) =>
    Promise<AsyncIterable<Propagator.Notebook>>;

  export namespace Propagator {
    export type Notebook = {
      identifier: Workbook.Identifier;
      notebook: INotebookContent;
      path: string;
    };
  }

  /**
   * A registrar that provides an immutable roster for a workbook.
   *
   * #### Notes
   * If the returned roster is null, user roster input is unlocked.
   * If it is an empty list or populated list, user roster input is locked.
   */
  export type Registrar = (
    workbook: Workbook,
    identifier: Workbook.Identifier
  ) => Promise<string[] | null>;

  export type Scheduler = (workbook: Workbook | null) => void;

  /**
   * The Correxit source asynchronously yields the active workbook or null.
   */
  export type Source = AsyncIterable<{ payload: Workbook.Headed | null }>;

  export type Submitter = (
    workbook: Workbook,
    identifier: Workbook.Identifier
  ) => Promise<string | null>;

  export type Unlocker = {
    /**
     * Store the key for a given rubric id.
     */
    store(id: string, key: string): Promise<void>;

    /**
     * Unlock a given workbook with the given credentials.
     */
    unlock(
      workbook: Workbook,
      credentials: Partial<Workbook.Credentials & { silent: boolean }> | null
    ): Promise<Rubric.Unlocked | null>;
  };

  export const COLLECTOR = 'correxit:collector';

  export const Collector = new Token<Collector>(COLLECTOR);

  export const CommandIDs = COMMAND_IDS;

  export const CONSUMER = '@quantstack/correxit:consumer';

  export const Consumer = new Token<Consumer>(CONSUMER);

  export const CORRECTOR = '@quantstack/correxit:corrector';

  export const DESCRIPTION = {
    COLLECTOR: description.COLLECTOR,
    CONSUMER: description.CONSUMER,
    CORRECTOR: description.CORRECTOR,
    REGISTRAR: description.REGISTRAR,
    SOURCE: description.SOURCE,
    SUBMITTER: description.SUBMITTER,
    UI: description.UI,
    UNLOCKER: description.UNLOCKER
  };

  export const Icons = ICONS;

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const REGISTRAR = '@quantstack/correxit:registrar';

  export const Registrar = new Token<Registrar>(REGISTRAR);

  export const SOURCE = '@quantstack/correxit:source';

  export const Source = new Token<Source>(SOURCE);

  export const SUBMITTER = '@quantstack/correxit:submitter';

  export const Submitter = new Token<Correxit.Submitter>(SUBMITTER);

  export const TOOLBARS = '@quantstack/correxit:toolbars';

  export const UI = '@quantstack/correxit:ui';

  export const UNLOCKER = '@quantstack/correxit:unlocker';

  export const Unlocker = new Token<Unlocker>(UNLOCKER);
}
