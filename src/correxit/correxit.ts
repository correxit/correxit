import { Token } from '@lumino/coreutils';
import * as description from './description';
import { Rubric as RUBRIC } from './rubric';
import { Workbook as WORKBOOK } from './workbook';

export namespace Correxit {
  export namespace CommandIDs {
    export const add = 'correxit:add';
    export const convert = 'correxit:convert';
    export const correct = 'correxit:correct';
    export const lock = 'correxit:lock';
    export const remove = 'correxit:remove';
    export const replace = 'correxit:replace';
    export const reset = 'correxit:reset';
    export const toggle = 'correxit:toggle';
    export const unlock = 'correxit:unlock';
  }

  export import Rubric = RUBRIC; // Expose entire `Rubric` export.

  export type Workbook = WORKBOOK; // Only export `Workbook` type.

  export namespace Workbook {
    export type Cell = WORKBOOK.Cell; // Only export `Cell` type.
  }

  /**
   * The core Correxit plugin registers commands and returns a workbook source.
   */
  export type Source = AsyncIterable<{ payload: Workbook | null }>;

  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const SIDEBAR = 'correxit:sidebar';

  export const SOURCE = 'correxit:source';

  export const TOOLBARS = 'correxit:toolbars';

  export const Source = new Token<Source>(SOURCE);

  export const DESCRIPTION = {
    SIDEBAR: description.SIDEBAR,
    SOURCE: description.SOURCE,
    TOOLBARS: description.TOOLBARS
  };

  export const { convert, correct, lock, open, reset, unlock } = WORKBOOK;

  export const { add, remove, toggle } = WORKBOOK.Cell;
}
