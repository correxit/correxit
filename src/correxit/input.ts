import { InputDialog } from '@jupyterlab/apputils';
import { Cell, ICellModel } from '@jupyterlab/cells';
import { Notebook } from '@jupyterlab/notebook';
import { filter } from '@lumino/algorithm';
import { PromiseDelegate } from '@lumino/coreutils';
import { Throttler } from '@lumino/polling';

const EXCLUDE_CLASS = 'cxt-mod-exclude';

const INCLUDE_CLASS = 'cxt-mod-include';

const OVERLAY_CLASS = 'correxit-overlay';

const TARGET_CELL_CLASS = 'correxit-target-cell';

/**
 * @returns a promise that resolves to a user input cell or `null`.
 */
export function cell(notebook: Notebook): Promise<ICellModel | null> {
  let target: Cell<ICellModel> | null = null;
  const delegate = new PromiseDelegate<ICellModel | null>();
  const overlay = document.createElement('div');
  const submit = () => {
    const model = target?.model || null;
    document.removeEventListener('pointerdown', pointerdown);
    document.removeEventListener('keydown', keydown);
    overlay.remove();
    target?.node.classList.remove(TARGET_CELL_CLASS);
    target = null;
    throttler.dispose();
    delegate.resolve(model);
  };
  const keydown = ({ key }: KeyboardEvent) => {
    if (key === 'Escape') {
      target?.node.classList.remove(TARGET_CELL_CLASS);
      target = null;
      submit();
    }
  };
  const pointerdown = () => submit();
  const throttler = new Throttler(
    ({ clientX, clientY }: PointerEvent) => {
      const cells = notebook.widgets;
      notebook.node.querySelectorAll(`.${TARGET_CELL_CLASS}`)
        .forEach(({ classList }) =>
          classList.remove(TARGET_CELL_CLASS, EXCLUDE_CLASS, INCLUDE_CLASS));
      for (const cell of filter(cells, cell => cell.inViewport)) {
        const rect = cell.node.getBoundingClientRect();
        const overlap = clientY >= rect.y &&
          clientY <= rect.y + rect.height &&
          clientX >= rect.x &&
          clientX <= rect.x + rect.width;
        if (overlap) {
          cell.node.classList.add(
            TARGET_CELL_CLASS,
            cell.model.type === 'code' ? INCLUDE_CLASS : EXCLUDE_CLASS
          );
          target = cell;
          return;
        }
      }
    },
    { limit: 100 }
  );
  const pointermove = (event: PointerEvent) => throttler.invoke(event);
  const pointerout = () => {
    target?.node.classList.remove(TARGET_CELL_CLASS);
    target = null;
  };
  overlay.classList.add(OVERLAY_CLASS);
  notebook.viewportNode.appendChild(overlay);
  overlay.addEventListener('pointermove', pointermove);
  overlay.addEventListener('pointerout', pointerout);
  document.addEventListener('pointerdown', pointerdown);
  document.addEventListener('keydown', keydown);
  return delegate.promise;
}

/**
 * @returns a promise that resolves with text input from the user.
 */
export const text = async (options: InputDialog.ITextOptions) => {
  const { button, value } = await InputDialog.getText(options);
  return button.accept && value || '';
};
