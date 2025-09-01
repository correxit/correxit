import { Token } from '@lumino/coreutils';
import { Workbook } from '.';
import * as description from './description';
import { Icons as ICONS } from './icons';

export namespace Correxit {
  export namespace CommandIDs {
    export const add = 'correxit:add';
    export const cd = 'correxit:cd';
    export const convert = 'correxit:convert';
    export const correct = 'correxit:correct';
    export const fetch = 'correxit:fetch';
    export const launch = 'correxit:launch';
    export const lock = 'correxit:lock';
    export const multicorrect = 'correxit:multicorrect';
    export const remove = 'correxit:remove';
    export const replace = 'correxit:replace';
    export const reset = 'correxit:reset';
    export const scan = 'correxit:scan';
    export const toggle = 'correxit:toggle';
    export const unlock = 'correxit:unlock';
  }

  /**
   * The core Correxit plugin registers commands and returns a workbook source.
   */
  export type Source = AsyncIterable<{ payload: Workbook.Headed | null }>;

  export const CELL_TOOLBAR = 'correxit:cell-toolbar';

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
