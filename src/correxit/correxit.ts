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

  export function cached(workbook: Workbook) {
    return Private.rubrics.get(workbook);
  }

  export async function convert(workbook: Workbook, key: string) {
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const opened = await open(workbook);
      const unlocked = opened.locked && await Rubric.unlock(opened, key);
      const rubric = unlocked || opened;
      Private.rubrics.set(workbook, rubric);
      await save(workbook, key, rubric);
      return rubric;
    } catch (error) {
      if (error === Private.NO_CORREXIT_METADATA) {
        await save(workbook, key);
        return unlock(workbook, key);
      }
      throw error;
    }
  }

  export async function lock(workbook: Workbook): Promise<void> {
    const rubric = Private.rubrics.get(workbook);
    if (!rubric || !workbook.content.model) {
      return;
    }
    const locked = rubric.locked ? rubric : await Rubric.lock(rubric);
    Private.rubrics.set(workbook, locked);
    workbook.content.model.setMetadata('correxit', locked);
    return workbook.context.save();
  }

  export async function open(
    workbook: Workbook
  ): Promise<Rubric<'locked'> | Rubric<'unlocked'>> {
    if (Private.rubrics.has(workbook)) {
      return Private.rubrics.get(workbook)!;
    }
    if (workbook.content.model === null) {
      throw new Error('workbook model is null');
    }

    const rubric: Rubric<'locked'> | null =
      workbook.content.model.getMetadata('correxit') || null;
    if (rubric === null) {
      throw Private.NO_CORREXIT_METADATA;
    }
    return Rubric.normalize(rubric);
  }

  export async function reset(workbook: Workbook) {
    Private.rubrics.delete(workbook);
    workbook.content.model?.deleteMetadata('correxit');
    return workbook.context.save();
  }

  export async function save(
    workbook: Workbook,
    key: string,
    rubric?: Rubric<'locked'> | Rubric<'unlocked'>
  ): Promise<void> {
    rubric = rubric || Rubric.create(key);
    const { content: { model }, context } = workbook;
    const locked = rubric.locked ? rubric : await Rubric.lock(rubric);
    model?.setMetadata('correxit', locked);
    return context.save();
  }

  export async function unlock(
    workbook: Workbook,
    key: string
  ): Promise<Rubric<'unlocked'>> {
    const opened = await open(workbook);
    const rubric = opened.locked ? await Rubric.unlock(opened, key) : opened;
    Private.rubrics.set(workbook, rubric);
    await save(workbook, key, rubric);
    return rubric;
  }
}

namespace Private {
  export const NO_CORREXIT_METADATA = new TypeError('no correxit metadata');

  export const rubrics = new WeakMap<
    Correxit.Workbook,
    Correxit.Rubric<'locked'> | Correxit.Rubric<'unlocked'>
  >();
}
