import * as description from './description';
import { Rubric as RUBRIC, type Workbook as WORKBOOK } from './rubric';

export namespace Correxit {
  export import Rubric = RUBRIC;

  export type Workbook = WORKBOOK;

  export const DESCRIPTION = {
    PLUGIN: description.PLUGIN,
    SIDEBAR: description.SIDEBAR
  };

  export const PLUGIN = 'correxit:plugin';

  export const SIDEBAR = 'correxit:sidebar';

  export async function convert({ key, workbook }: {
    key: string;
    workbook: Workbook;
  }) {
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const opened = await open(workbook);
      const unlocked = opened.locked && await Rubric.unlock(opened, key);
      const rubric = unlocked || opened;
      Rubric.set(workbook, rubric);
      await save({ key, rubric, workbook });
      return rubric;
    } catch (error) {
      if (error === Private.CREATE_NEW) {
        await save({ key, rubric: null, workbook });
        return unlock({ key, workbook });
      }
      throw error;
    }
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
  ): Promise<Rubric<'locked'> | Rubric<'unlocked'>> {
    if (Rubric.has(workbook)) {
      return Rubric.get(workbook)!;
    }
    if (workbook.content.model === null) {
      throw new Error('workbook model is null');
    }

    const rubric: Rubric<'locked'> | null =
      workbook.content.model.getMetadata('correxit') || null;
    if (rubric === null) {
      throw Private.CREATE_NEW;
    }
    return Rubric.normalize(rubric);
  }

  export async function reset(workbook: Workbook) {
    Rubric.clear(workbook);
    workbook.content.model?.deleteMetadata('correxit');
    return workbook.context.save();
  }

  export async function save({ key, rubric, workbook } : {
    key: string;
    rubric: Rubric<'locked'> | Rubric<'unlocked'> | null;
    workbook: Workbook;
  }): Promise<void> {
    rubric = rubric || Rubric.create(key);
    const { content: { model }, context } = workbook;
    const locked = rubric.locked ? rubric : await Rubric.lock(rubric);
    model?.setMetadata('correxit', locked);
    return context.save();
  }

  export async function unlock({ key, workbook }: {
    key: string;
    workbook: Workbook;
  }): Promise<Rubric<'unlocked'> | null> {
    const opened = await open(workbook);
    const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
    Rubric.set(workbook, rubric);
    await save({ key, rubric, workbook });
    return rubric;
  }
}

namespace Private {
  export const CREATE_NEW = new Error('no correxit metadata, create new');
}
