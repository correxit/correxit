import { INotebookContent } from '@jupyterlab/nbformat';
import { Token } from '@lumino/coreutils';
import { Rubric, Workbook } from '.';
import { CommandIDs as COMMAND_IDS } from './commands';
import * as description from './description';
import { Icons as ICONS } from './icons';

export namespace Correxit {
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

    export type Log = (payload: Emitter.Emission) => Promise<void>;
  }

  /**
   * An async propagator of assigned workbook content.
   */
  export type Propagator = (location: { base: string; pwd: string }) =>
    Promise<AsyncIterable<Propagator.Notebook>>;

  export namespace Propagator {
    export type Notebook = {
      /**
       * The assignee (typically an email address).
       */
      assignee: string;

      /**
       * The assignment id, i.e. the rubric id of the workbook.
       */
      assignment: string;

      /**
       * The raw notebook content JSON.
       */
      notebook: INotebookContent;

      /**
       * The suggested file path a local consumer should write the content to.
       */
      path: string;
    };
  }

  /**
   * A registrar that provides an immutable roster for a workbook.
   */
  export type Registrar = (workbook: Workbook) => Promise<string[] | null>;

  /**
   * The core Correxit plugin registers commands and returns a workbook source.
   */
  export type Source = AsyncIterable<{ payload: Workbook.Headed | null }>;

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

  export const CommandIDs = COMMAND_IDS;

  export const CONSUMER = '@quantstack/correxit:consumer';

  export const Consumer = new Token<Consumer>(CONSUMER);

  export const CORRECTOR = '@quantstack/correxit:corrector';

  export const DESCRIPTION = {
    CONSUMER: description.CONSUMER,
    CORRECTOR: description.CORRECTOR,
    REGISTRAR: description.REGISTRAR,
    SOURCE: description.SOURCE,
    UI: description.UI,
    UNLOCKER: description.UNLOCKER
  };

  export const Icons = ICONS;

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const REGISTRAR = '@quantstack/correxit:registrar';

  export const Registrar = new Token<Registrar>(REGISTRAR);

  export const SOURCE = '@quantstack/correxit:source';

  export const Source = new Token<Source>(SOURCE);

  export const TOOLBARS = '@quantstack/correxit:toolbars';

  export const UI = '@quantstack/correxit:ui';

  export const UNLOCKER = '@quantstack/correxit:unlocker';

  export const Unlocker = new Token<Unlocker>(UNLOCKER);
}
