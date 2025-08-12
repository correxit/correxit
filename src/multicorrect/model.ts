import { Context } from '@jupyterlab/docregistry';
import { INotebookModel, NotebookModelFactory } from '@jupyterlab/notebook';
import { Contents, ServiceManager } from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';

import { IMultiCorrectModel, IWorkbookModel } from './types';
import { Rubric } from '../correxit/rubric';
import { keygen } from '../correxit/security';
import { Workbook } from '../correxit/workbook';

/**
 * The model associated to the multi correct widget.
 */
export class MultiCorrectModel implements IMultiCorrectModel {
  constructor(options: MultiCorrectModel.IOptions) {
    this._serviceManager = options.serviceManager;
    if (options.path) {
      this._path = options.path;
    }
  }

  /**
   * The current path.
   */
  get path(): string {
    return this._path;
  }

  /**
   * A signal emitting when the path changed.
   */
  get pathChanged(): ISignal<IMultiCorrectModel, string> {
    return this._pathChanged;
  }

  /**
   * A signal emitting when the list of workbook changed.
   */
  get workbooksChanged(): ISignal<IMultiCorrectModel, IWorkbookModel[]> {
    return this._workbooksChanged;
  }

  /**
   * Set the passphrase to use to unlock and decrypt workbooks.
   *
   * @param value - the passphrase.
   */
  setPassphrase(value: string): void {
    Private.setPassphrase(value);
  }

  /**
   * Set the path to the given value, and return a promise whether the has been updated.
   *
   * @param value - the new path.
   */
  setPath = async (value: string) => {
    return this._serviceManager.contents
      .get(value)
      .then(model => {
        if (model.type === 'directory') {
          this._path = value;
          this.initWorkbooks();
          this._pathChanged.emit(this._path);
        }
      })
      .catch(() => {
        // no-op
      });
  };

  /**
   * Correct the workbooks from a directory.
   *
   * @param path - if provided, only correct the workbook with this path.
   */
  correct = async (): Promise<void> => {
    this._workbookModels.forEach(model => {
      model.setStatus('scheduled');
    });

    for (const model of this._workbookModels) {
      await model.correct();
    }
  };

  /**
   * Initialize the scores for all workbooks (default to UNSCORED).
   */
  async initWorkbooks(): Promise<void> {
    this._workbookModels.forEach(model => model.dispose());
    this._workbookModels = [];
    this._workbooksChanged.emit(this._workbookModels);
    const contentModels = await this._listWorkbooks();
    contentModels.forEach(contentModel => {
      this._workbookModels.push(
        new WorkbookModel({
          workbook: contentModel,
          path: contentModel.context.path
        })
      );
    });
    this._workbooksChanged.emit(this._workbookModels);
  }

  /**
   * List the workbook files in the current directory.
   */
  private async _listWorkbooks(): Promise<Workbook[]> {
    const model = await this._serviceManager.contents.get(this._path);
    const files: Contents.IModel[] = model.content;
    const notebookFiles = files.filter(file => {
      if (file.type !== 'notebook') {
        return false;
      }
      if (typeof this._pattern === 'string') {
        return file.name.startsWith(this._pattern);
      } else if (this._pattern) {
        return this._pattern.test(file.name);
      }
      return true;
    });

    // Keep only the workbooks.
    const workbooks: Workbook[] = [];
    for (const file of notebookFiles) {
      const workbook = await this._getWorkbook(file.path);
      const rubric = Workbook.open(workbook, true);
      if (rubric) {
        workbooks.push(workbook);
      }
    }
    return workbooks;
  }

  /**
   * Return a workbook for a given path.
   * Since the workbook is not opened, there is no content.
   */
  private async _getWorkbook(path: string): Promise<Workbook> {
    const context = new Context<INotebookModel>({
      manager: this._serviceManager,
      factory: new NotebookModelFactory(),
      path
    });
    context.initialize(false);

    return context.ready.then(() => {
      return { context, content: null };
    });
  }

  private _serviceManager: ServiceManager.IManager;
  private _path: string = '';
  private _pattern?: string | RegExp;
  private _workbookModels: WorkbookModel[] = [];
  private _workbooksChanged = new Signal<IMultiCorrectModel, IWorkbookModel[]>(
    this
  );
  private _pathChanged = new Signal<IMultiCorrectModel, string>(this);
}

export namespace MultiCorrectModel {
  /**
   * The construction options of the multi correct model.
   */
  export interface IOptions {
    /**
     * Service manager.
     */
    serviceManager: ServiceManager.IManager;
    /**
     * The initial path of the model.
     */
    path?: string;
  }
}

export class WorkbookModel implements IWorkbookModel {
  constructor(options: WorkbookModel.IOptions) {
    this._workbook = options.workbook;
    if (options.score !== undefined) {
      this._state.score = options.score;
    }
  }

  get path(): string {
    return this._workbook.context.path;
  }

  get state(): IWorkbookModel.IState {
    return this._state;
  }

  get stateChanged(): ISignal<IWorkbookModel, IWorkbookModel.IState> {
    return this._stateChanged;
  }

  setStatus(value: IWorkbookModel.Status) {
    this._state.status = value;
    this._stateChanged.emit(this._state);
  }

  dispose() {
    this._workbook.context.dispose();
    this.isDisposed = true;
  }

  correct = async () => {
    this._state.error = '';
    this.setStatus('correcting');
    const rubric = await this._unlock();
    if (!rubric) {
      this._state.score = Rubric.UNSCORED;
      this._state.kernelSpec = undefined;
    } else {
      try {
        const result = await Workbook.correct(this._workbook, undefined);
        this._state.score = result.score;
        this._state.kernelSpec = result.kernelSpec;
      } catch (e) {
        this._state.error = 'scoring error';
        this._state.score = Rubric.UNSCORED;
        this._state.kernelSpec = undefined;
      }
    }
    await Workbook.lock(this._workbook);
    this.setStatus('not scheduled');
  };

  /**
   * Unlock the rubric of the workbook.
   */
  private async _unlock(): Promise<Rubric.Unlocked | null> {
    let rubric = Workbook.open(this._workbook);
    if (!rubric?.locked) {
      return rubric;
    }
    const key = await keygen(Private.getPassphrase(), rubric.id);
    try {
      rubric = await Rubric.unlock(rubric, key);
    } catch (e) {
      this._state.error = 'decryption error';
      return null;
    }
    rubric = await Workbook.decrypt(this._workbook, rubric);
    return rubric;
  }

  isDisposed = false;
  private _workbook: Workbook;
  private _state: IWorkbookModel.IState = {
    status: 'not scheduled',
    score: Rubric.UNSCORED,
    error: ''
  };
  private _stateChanged = new Signal<IWorkbookModel, IWorkbookModel.IState>(
    this
  );
}

namespace WorkbookModel {
  export interface IOptions {
    /**
     * Service manager.
     */
    workbook: Workbook;
    /**
     * The path of the file.
     */
    path: string;
    /**
     * An initial score.
     */
    score?: Rubric.Score;
  }
}

/**
 * A private namespace.
 */
namespace Private {
  /**
   * Keeping the passphrase private.
   */
  let passphrase: string = '';
  export function getPassphrase(): string {
    return passphrase;
  }
  export function setPassphrase(value: string): void {
    passphrase = value;
  }
}
