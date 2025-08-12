import { KernelSpec } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';
import { ISignal } from '@lumino/signaling';

import { Rubric } from '../correxit/rubric';

/**
 * The command IDs related to multi correct.
 */
export const MultiCorrectCommandIDs = {
  /**
   * Opening the panel.
   */
  open: 'correxit:multi-correct-open'
};

/**
 * The correct model interface.
 */
export interface IMultiCorrectModel {
  /**
   * The current path.
   */
  readonly path: string;
  /**
   * A signal emitting when the path changed.
   */
  readonly pathChanged: ISignal<IMultiCorrectModel, string>;
  /**
   * A signal emitting when the list of workbook changed.
   */
  readonly workbooksChanged: ISignal<IMultiCorrectModel, IWorkbookModel[]>;
  /**
   * Set the passphrase to use to unlock and decrypt workbooks.
   *
   * @param value - the passphrase.
   */
  setPassphrase(value: string): void;
  /**
   * Set the path to the given value, and return a promise whether the has been updated.
   *
   * @param value - the new path.
   */
  setPath(value: string): void;
  /**
   * Correct the workbooks from a directory.
   */
  correct(): Promise<void>;
  /**
   * Initialize the scores for all workbooks (default to UNSCORED).
   */
  initWorkbooks(): Promise<void>;
}

/**
 * The correct model interface.
 */
export interface IWorkbookModel extends IDisposable {
  /**
   * The current path.
   */
  readonly path: string;
  /**
   * The current path.
   */
  readonly state: IWorkbookModel.IState;
  /**
   * A signal emitting when the state changed.
   */
  readonly stateChanged: ISignal<IWorkbookModel, IWorkbookModel.IState>;
  /**
   * Correct the workbook.
   */
  correct(): Promise<void>;
}

export namespace IWorkbookModel {
  /**
   * The type of status.
   */
  export type Status = 'not scheduled' | 'scheduled' | 'correcting';
  /**
   * The current state of the model.
   */
  export interface IState {
    /**
     * The correction status.
     */
    status: Status;
    /**
     * The score of the latest correction.
     */
    score: Rubric.Score;
    /**
     * The error raised during the latest correction.
     */
    error: string;
    /**
     * The specs of the kernel used during the latest correction.
     */
    kernelSpec?: KernelSpec.ISpecModel;
  }
}
