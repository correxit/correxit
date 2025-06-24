import { Cell, ICellModel } from '@jupyterlab/cells';
import { Notebook, NotebookPanel } from '@jupyterlab/notebook';
import { PromiseDelegate } from '@lumino/coreutils';

const WATERMARK_CLASS = 'correxit-watermark';
const TARGET_CELL_CLASS = 'correxit-targetCell';

export namespace CellSelection {
  export interface IOptions {
    notebook: NotebookPanel;
  }
}

/**
 * The cell selection class.
 */
export class CellSelection {
  constructor(options: CellSelection.IOptions) {
    this._notebook = options.notebook;

    // Add a watermark above the notebook viewport.
    this._watermark = document.createElement('div');
    this._watermark.classList.add(WATERMARK_CLASS);
    this._notebook.content.viewportNode.appendChild(this._watermark);

    // Get the current cells in viewport.
    for (const cell of this._notebook.content.widgets) {
      if (cell.inViewport) {
        this._viewportCells.push(cell);
      }
    }

    // Update the list of cells in viewport.
    this._notebook.content.cellInViewportChanged.connect(
      this._cellInViewportChanged
    );

    // Add some event listeners on document and watermark.
    this._watermark.onmousemove = this._onmousemove;
    this._watermark.onmouseout = this._onmouseout;
    // this._watermark.onkeydown = this._onkeydown;
    document.addEventListener('mousedown', this._onDocumentMousedown);
    document.addEventListener('keydown', this._onDocumentKeydown);
  }

  /**
   * A promise that resolve or reject whether a cell has been selected or not.
   */
  get selection(): Promise<Cell<ICellModel>> {
    return this._selection.promise;
  }

  /**
   * Submit the selection if it is valid (resolve), otherwise reject.
   * This function cleans the listener and signal connection.
   *
   * @param rejectReason - A reason to reject the selection.
   */
  private _submit(rejectReason?: string) {
    document.removeEventListener('mousedown', this._onDocumentMousedown);
    document.removeEventListener('keydown', this._onDocumentKeydown);
    this._notebook.content.cellInViewportChanged.disconnect(
      this._cellInViewportChanged
    );
    this._watermark.remove();
    this._targetCell?.node.classList.remove(TARGET_CELL_CLASS);
    if (rejectReason || this._targetCell === null) {
      this._selection.reject(rejectReason ?? 'No cell has been selected');
    } else {
      this._selection.resolve(this._targetCell);
    }
  }

  /**
   * Triggered when a cell is added or removed from the notebook viewport.
   * It updates the viewport list accordingly.
   */
  private _cellInViewportChanged = (_: Notebook, cell: Cell<ICellModel>) => {
    const index = this._viewportCells.indexOf(cell);
    if (cell.inViewport && index === -1) {
      this._viewportCells.push(cell);
    } else if (!cell.inViewport && index > -1) {
      this._viewportCells.splice(index, 1);
    }
  };

  /**
   * Triggered on document mouse down, to submit the target cell or reject if the event
   * is not on the watermark;
   */
  private _onDocumentMousedown = (ev: MouseEvent) => {
    const target = ev.target;
    if (target === this._watermark) {
      this._submit();
    } else {
      this._submit('No selection (click outside)');
    }
  };

  /**
   * Triggered on document key down, to handle the escape key.
   */
  private _onDocumentKeydown = (ev: KeyboardEvent) => {
    const key = ev.key;
    if (key === 'Escape') {
      this._submit('No selection (escape key)');
    }
  };

  /**
   * Triggered when the mouse move over the watermark, to retrieve the cell below.
   */
  private _onmousemove = (ev: MouseEvent) => {
    const cursorX = ev.clientX;
    const cursorY = ev.clientY;
    for (const cell of this._viewportCells) {
      const bbox = cell.node.getBoundingClientRect();
      if (
        cursorY >= bbox.y &&
        cursorY <= bbox.y + bbox.height &&
        cursorX >= bbox.x &&
        cursorX <= bbox.x + bbox.width
      ) {
        cell.node.classList.add(TARGET_CELL_CLASS);
        this._targetCell = cell;
      } else {
        cell.node.classList.remove(TARGET_CELL_CLASS);
      }
    }
  };

  /**
   * Triggered when the mouse move out of the watermark, to remove the targeted cell.
   */
  private _onmouseout = (ev: MouseEvent) => {
    this._targetCell?.node.classList.remove(TARGET_CELL_CLASS);
    this._targetCell = null;
  };

  private _notebook: NotebookPanel;
  private _watermark: HTMLDivElement;
  private _viewportCells: Cell<ICellModel>[] = [];
  private _targetCell: Cell<ICellModel> | null = null;
  private _selection = new PromiseDelegate<Cell<ICellModel>>();
}
