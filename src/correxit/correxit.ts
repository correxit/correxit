import { InputDialog, showDialog } from '@jupyterlab/apputils';
import { IRenderMime } from '@jupyterlab/rendermime';
import * as description from './description';
import {
  type Locked as LOCKED,
  type Unlocked as UNLOCKED,
  Rubric as RUBRIC,
  type Workbook as WORKBOOK
} from './rubric';
import { keygen } from './security';

export namespace Correxit {
  export type Locked = LOCKED;

  export type Unlocked = UNLOCKED;

  export import Rubric = RUBRIC;

  export type Workbook = WORKBOOK;

  export const DESCRIPTION = {
    PLUGIN: description.PLUGIN,
    SIDEBAR: description.SIDEBAR
  };

  export const PLUGIN = 'correxit:plugin';

  export const SIDEBAR = 'correxit:sidebar';

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
    body?: string,
    quiet?: boolean;
    title?: string;
    workbook: Workbook;
  }) {
    if (quiet !== true) {
      const prompt = await showDialog({ title, body });
      if (prompt.button.accept === false) {
        return;
      }
    }
    Rubric.clear(workbook);
    workbook.content.model?.deleteMetadata('correxit');
    await workbook.context.save();
  }

  export async function save({ key, rubric, trans, workbook } : {
    key: string;
    trans: IRenderMime.TranslationBundle;
    rubric: Rubric<Locked | Unlocked> | null,
    workbook: Workbook;
  }): Promise<void> {
    rubric = rubric || Rubric.create(key);
    const { content: { model }, context } = workbook;
    const locked = rubric.locked ? rubric : await Rubric.lock(rubric);
    model!.setMetadata('correxit', locked);
    await context.save();
  }


  export async function unlock({ key, trans, workbook }: {
    key?: string;
    trans: IRenderMime.TranslationBundle;
    workbook: Workbook;
  }): Promise<Rubric<Unlocked> | null> {
    key = key ?? await Private.prompt({ trans });
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const rubric = await open(workbook);
      const unlocked = await Rubric.unlock(rubric, key);
      Rubric.set(workbook, unlocked);
      await save({ key, rubric: unlocked, trans, workbook });
      return unlocked;
    } catch (error) {
      if (error === Private.CREATE_NEW) {
        await save({ key, rubric: null, trans, workbook });
        return unlock({ key, trans, workbook });
      }
      throw error;
    }
  }
}

namespace Private {
  export const CREATE_NEW = new Error('no correxit metadata, create new');

  export const prompt = async ({ trans }: {
    trans: IRenderMime.TranslationBundle
  }) => {
    const passphrase = await InputDialog.getText({
      title: trans.__('Enter a passphrase'),
      label: trans.__('Enter a passphrase for this workbook')
    });
    if (passphrase.button.accept && passphrase.value) {
      return await keygen(passphrase.value);
    }
    return '';
  }
}
