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

  export import Rubric = RUBRIC;

  export import Workbook = WORKBOOK;

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

  export const add = Workbook.Cell.add;

  export const convert = Workbook.convert;

  export const correct = Workbook.correct;

  export const lock = Workbook.lock;

  export const remove = Workbook.Cell.remove;

  export const reset = Workbook.reset;

  export const toggle = Workbook.Cell.toggle;

  export const unlock = Workbook.unlock;

  /**
   * Opens a workbook's rubric.
   *
   * @param workbook - The current workbook. May be `null`.
   * @param options.quiet - Whether to return `null` instead of rejecting.
   * @returns a promise that resolves to a rubric for a workbook.
   *
   * #### Notes
   * If `quiet` is set to true, the promise resolves with `null` instead of
   * rejecting. By default the promise either resolves with a rubric or rejects.
   */
  export function open(
    workbook: Workbook | null,
    { quiet }: { quiet?: boolean } = {}
  ): Rubric | null {
    if (!workbook || !workbook.content.model) {
      if (quiet) {
        return null;
      }
      throw new Error('workbook or content model is null');
    }
    try {
      return Workbook.open(workbook);
    } catch (error) {
      if (quiet) {
        return null;
      }
      throw error;
    }
  }
}
