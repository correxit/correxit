import { Token } from '@lumino/coreutils';
import { Workbook } from '.';
import { CommandIDs as COMMAND_IDS } from './commands';
import * as description from './description';
import { Icons as ICONS } from './icons';

export namespace Correxit {
  /**
   * The core Correxit plugin registers commands and returns a workbook source.
   */
  export type Source = AsyncIterable<{ payload: Workbook.Headed | null }>;

  export const CELL_TOOLBAR = 'correxit:cell-toolbar';

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
