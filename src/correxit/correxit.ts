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
     * An notification/message emission with slots to populate interpolations.
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
    export type Notebook = { notebook: INotebookContent; path: string; };
  }

  /**
   * The core Correxit plugin registers commands and returns a workbook source.
   */
  export type Source = AsyncIterable<{ payload: Workbook.Headed | null }>;

  export const CommandIDs = COMMAND_IDS;

  export const CONSUMER = 'correxit:consumer';

  export const Consumer = new Token<Consumer>(CONSUMER);

  export const CORRECTOR = 'correxit:corrector';

  export const DESCRIPTION = {
    CONSUMER: description.CONSUMER,
    CORRECTOR: description.CORRECTOR,
    SOURCE: description.SOURCE,
    UI: description.UI
  };

  export const Icons = ICONS;

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const SOURCE = 'correxit:source';

  export const Source = new Token<Source>(SOURCE);

  export const TOOLBARS = 'correxit:toolbars';

  export const UI = 'correxit:ui';

  export const UNLOCKER = 'correxit:unlocker';

  export type Unlocker = {
    unlock(
      workbook: Workbook,
      key: string | null
    ): Promise<Rubric.Unlocked | null>;
    store(id: string, key: string): Promise<void>;
  };

  export const Unlocker = new Token<Unlocker>(UNLOCKER);
}
