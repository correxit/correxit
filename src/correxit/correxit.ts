import { Token } from '@lumino/coreutils';
import { Rubric, Workbook } from '.';
import { CommandIDs as COMMAND_IDS } from './commands';
import * as description from './description';
import { Icons as ICONS } from './icons';

export namespace Correxit {
  /**
   * A message emitter for notifications and other Correxit UI updates.
   */
  export type Emitter = AsyncIterable<{ payload: Emitter.Emission }>;

  export namespace Emitter {
    /**
     * An notification/message emission with slots to populated interpolations.
     */
    export type Emission = { slots: (string | number)[]; type: string; };

    export async function after(emitter: Emitter, action: () => void) {
      for await (const _ of emitter) {
        void _;
      }
      action();
    }
  }

  export type Propagator = {
    assign: (workbook: Workbook, assignment: Rubric.Assignment)
      => Promise<void>;
    location: (workbook: Workbook)
      => Promise<string>;
  }

  /**
   * The core Correxit plugin registers commands and returns a workbook source.
   */
  export type Source = AsyncIterable<{ payload: Workbook.Headed | null }>;

  export const CommandIDs = COMMAND_IDS;

  export const CORRECTOR = 'correxit:corrector';

  export const DESCRIPTION = {
    CORRECTOR: description.CORRECTOR,
    SIDEBAR: description.SIDEBAR,
    SOURCE: description.SOURCE,
    TOOLBARS: description.TOOLBARS
  };

  export const Icons = ICONS;

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const SIDEBAR = 'correxit:sidebar';

  export const SOURCE = 'correxit:source';

  export const Source = new Token<Source>(SOURCE);

  export const TOOLBARS = 'correxit:toolbars';
}
