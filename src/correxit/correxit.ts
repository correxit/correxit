import { InputDialog, showDialog } from '@jupyterlab/apputils';
import { DocumentRegistry } from '@jupyterlab/docregistry';
import { INotebookModel, Notebook } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import { UUID } from '@lumino/coreutils';
import * as description from './description';
import { decrypt, encrypt, keygen } from './security';

export namespace Correxit {
  export type Locked = 0;

  export type Unlocked = 1;

  export type Rubric<T extends Locked | Unlocked> = {
    readonly id: string;

    readonly key: T extends Locked ? null : string;

    readonly locked: T extends Locked ? true : false;

    readonly secret: T extends Locked ? string : Rubric.Section;

    readonly shared: Rubric.Section;
  };

  export namespace Rubric {
    export type Section = { cells: Record<string, never>; };

    export function create(key: string): Rubric<Unlocked> {
      return {
        id: `wb-${UUID.uuid4()}`, key,
        locked: false,
        secret: { cells: {} },
        shared: { cells: {} }
      };
    }

    export function get(workbook: Workbook): Rubric<Locked | Unlocked> | null {
      return Private.get(workbook) || null;
    }

    export function has(workbook: Workbook) {
      return Private.has(workbook);
    }

    export async function lock(
      rubric: Rubric<Unlocked>
    ): Promise<Rubric<Locked>> {
      const { id, key, secret, shared } = rubric;
      return {
        id, key: null,
        locked: true,
        secret: await encrypt(JSON.stringify(secret), key),
        shared
      };
    }

    export function normalize(
      { id, key, locked, secret, shared }: Partial<Rubric<Locked>>
    ): Rubric<Locked> {
      if (!id) {
        throw new Error('invalid rubric, missing id');
      }
      if (key !== null) {
        throw new Error('invalid rubric, missing null key');
      }
      if (locked !== true) {
        throw new Error('invalid rubric, must be locked');
      }
      if (typeof secret !== 'string' || secret.length === 0) {
        throw new Error('invalid rubric, missing secret section');
      }
      if (!(shared && shared.cells)) {
        throw new Error('invalid rubric, invalid shared section')
      }
      return { id, key, locked, secret, shared };
    }

    export async function unlock(
      rubric: Rubric<Locked>,
      key: string
    ): Promise<Rubric<Unlocked>> {
      return {
        id: rubric.id,
        key,
        locked: false,
        secret: JSON.parse(await decrypt(rubric.secret as string, key)),
        shared: rubric.shared
      };
    }
  }

  export type Workbook = {
    readonly content: Notebook;
    readonly context: DocumentRegistry.IContext<INotebookModel>;
  };

  export const DESCRIPTION = {
    PLUGIN: description.PLUGIN,
    SIDEBAR: description.SIDEBAR
  };

  export const PLUGIN = 'correxit:plugin';

  export const SIDEBAR = 'correxit:sidebar';

  const prompt = async ({ trans }: {
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

  const CREATE_NEW = new Error('no correxit data available, create new');

  export async function lock({ workbook }: {
    workbook: Workbook;
  }): Promise<void> {
    const rubric = Private.get(workbook);
    if (!rubric || !workbook.content.model) {
      return;
    }
    const locked = rubric.locked ? rubric : await Rubric.lock(rubric);
    Private.set(workbook, locked);
    workbook.content.model.setMetadata('correxit', locked);
    return workbook.context.save();
  }

  export async function open(
    workbook: Workbook
  ): Promise<Rubric<Locked | Unlocked>> {
    if (Private.has(workbook)) {
      return Private.get(workbook)!;
    }
    if (workbook.content.model === null) {
      throw new Error('workbook model is null');
    }

    const rubric: Rubric<Locked> | null =
      workbook.content.model.getMetadata('correxit') || null;
    if (rubric === null) {
      throw CREATE_NEW;
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
    Private.clear(workbook);
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
    key = key ?? await prompt({ trans });
    if (key.length !== 64) {
      throw new Error('cannot unlock a workbook without a valid key');
    }
    try {
      const rubric = await open(workbook);
      const unlocked = await Rubric.unlock(rubric, key);
      Private.set(workbook, unlocked);
      await save({ key, rubric: unlocked, trans, workbook });
      return unlocked;
    } catch (error) {
      if (error === CREATE_NEW) {
        await save({ key, rubric: null, trans, workbook });
        return unlock({ key, trans, workbook });
      }
      throw error;
    }
  }
}

namespace Private {
  const rubrics = new WeakMap<
    Correxit.Workbook,
    Correxit.Rubric<Correxit.Locked | Correxit.Unlocked>
  >();

  export const clear = (key: Correxit.Workbook) => rubrics.delete(key);

  export const get = (key: Correxit.Workbook) => rubrics.get(key);

  export const has = (key: Correxit.Workbook) => rubrics.has(key);

  export const set = (
    index: Correxit.Workbook,
    value: Correxit.Rubric<Correxit.Locked | Correxit.Unlocked>
  ) => rubrics.set(index, value);
}
