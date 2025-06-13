import { showDialog } from '@jupyterlab/apputils';
import { IRenderMime } from '@jupyterlab/rendermime';
import * as description from './description';
import {
  type Locked,
  Rubric as RUBRIC,
  type Workbook as WORKBOOK,
  type Unlocked,
} from './rubric';

export namespace Correxit {
  export import Rubric = RUBRIC;

  export type Workbook = WORKBOOK;

  export const DESCRIPTION = {
    PLUGIN: description.PLUGIN,
    SIDEBAR: description.SIDEBAR
  };

  export const PLUGIN = 'correxit:plugin';

  export const SIDEBAR = 'correxit:sidebar';


  export async function convert({ key, trans, workbook }: {
    key: string;
    trans: IRenderMime.TranslationBundle;
    workbook: Workbook;
  }) {
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    return unlock({ key, trans, workbook });
  }

  export async function lock({ workbook }: {
    workbook: Workbook;
  }): Promise<void> {
    const rubric = Rubric.get(workbook);
    if (!rubric || !workbook.content.model) {
      return;
    }
    const locked = rubric.locked ? rubric : await Rubric.lock(rubric);
    Rubric.set(workbook, locked);
    workbook.content.model.setMetadata('correxit', locked);
    return workbook.context.save();
  }

  export async function open(
    workbook: Workbook
  ): Promise<Rubric<Locked | Unlocked>> {
    if (Rubric.has(workbook)) {
      return Rubric.get(workbook)!;
    }
    if (workbook.content.model === null) {
      throw new Error('workbook model is null');
    }

    const rubric: Rubric<Locked> | null =
      workbook.content.model.getMetadata('correxit') || null;
    if (rubric === null) {
      throw Private.CREATE_NEW;
    }
    return Rubric.normalize(rubric);
  }

  export async function reset({ body, quiet, title, workbook } : {
    body?: string;
    quiet?: boolean;
    title?: string;
    workbook: Workbook;
  }) {
    if (!quiet && body || title) {
      const { button: { accept } } = await showDialog({ body, title });
      if (!accept) {
        return;
      }
    }
    Rubric.clear(workbook);
    workbook.content.model?.deleteMetadata('correxit');
    return workbook.context.save();
  }

  export async function save({ key, rubric, workbook } : {
    key: string;
    rubric: Rubric<Locked | Unlocked> | null;
    workbook: Workbook;
  }): Promise<void> {
    rubric = rubric || Rubric.create(key);
    const { content: { model }, context } = workbook;
    const locked = rubric.locked ? rubric : await Rubric.lock(rubric);
    model?.setMetadata('correxit', locked);
    return context.save();
  }

  export async function unlock({ key, trans, workbook }: {
    key: string;
    trans: IRenderMime.TranslationBundle;
    workbook: Workbook;
  }): Promise<Rubric<Unlocked> | null> {
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const rubric = await open(workbook);
      const unlocked = await Rubric.unlock(rubric, key);
      Rubric.set(workbook, unlocked);
      await save({ key, rubric: unlocked, workbook });
      return unlocked;
    } catch (error) {
      if (error === Private.CREATE_NEW) {
        await save({ key, rubric: null, workbook });
        return unlock({ key, trans, workbook });
      }
      throw error;
    }
  }
}

namespace Private {
  export const CREATE_NEW = new Error('no correxit metadata, create new');
}
