import { InputDialog } from '@jupyterlab/apputils';
import { Cell, ICellModel } from '@jupyterlab/cells';
import { filter } from '@lumino/algorithm';
import { PromiseDelegate } from '@lumino/coreutils';
import { Throttler } from '@lumino/polling';
import { Workbook } from '..';

const EXCLUDE = 'cxt-mod-exclude';

const INCLUDE = 'cxt-mod-include';

const OVERLAY = 'correxit-overlay';

const TARGET_CELL = 'correxit-target-cell';

/**
 * @returns a promise that resolves to a user input cell or `null`.
 */
export function cell(workbook: Workbook.Headed): Promise<ICellModel | null> {
  let target: Cell<ICellModel> | null = null;
  const delegate = new PromiseDelegate<ICellModel | null>();
  const overlay = document.createElement('div');
  const clear = (cell: Cell<ICellModel> | null) => {
    cell?.removeClass(TARGET_CELL);
    cell?.removeClass(EXCLUDE);
    cell?.removeClass(INCLUDE);
  };
  const submit = () => {
    const model = target?.model || null;
    clear(target);
    document.removeEventListener('click', click);
    document.removeEventListener('keydown', keydown);
    overlay.remove();
    target = null;
    throttler.dispose();
    delegate.resolve(model);
  };
  const keydown = ({ key }: KeyboardEvent) => {
    if (key === 'Escape') {
      clear(target);
      target = null;
      submit();
    }
  };
  const click = () => submit();
  const throttler = new Throttler(
    ({ clientX, clientY }: PointerEvent) => {
      const notebook = workbook.content;
      const cells = notebook.widgets;
      clear(target);
      for (const cell of filter(cells, cell => cell.inViewport)) {
        const code = cell.model.type === 'code';
        const rect = cell.node.getBoundingClientRect();
        const overlap = clientY >= rect.y &&
          clientY <= rect.y + rect.height &&
          clientX >= rect.x &&
          clientX <= rect.x + rect.width;
        if (overlap) {
          cell.addClass(TARGET_CELL);
          cell.addClass(code ? INCLUDE : EXCLUDE);
          target = cell;
          return;
        }
      }
    },
    { limit: 100 }
  );
  const pointermove = (event: PointerEvent) => throttler.invoke(event);
  const pointerout = () => {
    clear(target);
    target = null;
  };
  overlay.classList.add(OVERLAY);
  workbook.content.viewportNode.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.addEventListener('pointermove', pointermove);
    overlay.addEventListener('pointerout', pointerout);
    document.addEventListener('click', click);
    document.addEventListener('keydown', keydown);
  });
  return delegate.promise;
}

/**
 * @returns a promise that resolves with text input from the user.
 */
export const text = async (options: InputDialog.ITextOptions) => {
  const { button, value } = await InputDialog.getText(options);
  return button.accept && value || '';
};
