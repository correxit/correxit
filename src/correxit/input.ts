import { InputDialog } from '@jupyterlab/apputils';
import { Cell, ICellModel } from '@jupyterlab/cells';
import { filter } from '@lumino/algorithm';
import { PromiseDelegate } from '@lumino/coreutils';
import { Throttler } from '@lumino/polling';
import { Workbook } from '..';

const EXCLUDE = 'cxt-mod-exclude';

const INCLUDE = 'cxt-mod-include';

const OVERLAY = 'correxit-overlay';

const PANEL = 'correxit-chooser';

const TARGET_CELL = 'correxit-target-cell';

/** @returns a user input cell or `null`. */
export function cell(
  workbook: Workbook.Headed,
  options: {
    blocked?: Iterable<string>;
    empty: string;
    id?: string | null;
    message: (
      cell: { id: string; index: number; valid: boolean; }
    ) => string;
    prompt: string;
    title: string;
  }
): Promise<ICellModel | null> {
  const notebook = workbook.content;
  const cells = [...notebook.widgets];
  const blocked = new Set(options.blocked || []);
  const delegate = new PromiseDelegate<ICellModel | null>();
  const overlay = document.createElement('div');
  const panel = document.createElement('div');
  const heading = document.createElement('h2');
  const prompt = document.createElement('p');
  const status = document.createElement('p');
  const restore = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const claim = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panel.contains(active)) active.blur();
    panel.focus({ preventScroll: true });
  };
  const usable = (
    cell: Cell<ICellModel> | null
  ): cell is Cell<ICellModel> => {
    return !!cell && cell.model.type === 'code' && !blocked.has(cell.model.id);
  };
  const selectable = cells.filter(usable);
  const first = selectable[0] || null;
  const last = selectable[selectable.length - 1] || null;
  let target: Cell<ICellModel> | null = null;
  const clear = (cell: Cell<ICellModel> | null) => {
    cell?.removeClass(TARGET_CELL);
    cell?.removeClass(EXCLUDE);
    cell?.removeClass(INCLUDE);
  };
  const set = (cell: Cell<ICellModel> | null) => {
    if (cell === target) return;

    clear(target);
    target = cell;
    if (!cell) {
      status.dataset.state = selectable.length ? 'invalid' : 'empty';
      status.textContent = options.empty;
      return;
    }

    const index = cells.indexOf(cell) + 1;
    const valid = usable(cell);
    const state = valid ? INCLUDE : EXCLUDE;
    cell.addClass(TARGET_CELL);
    cell.addClass(state);
    status.dataset.state = valid ? 'valid' : 'invalid';
    status.textContent = options.message({ id: cell.model.id, index, valid });
  };
  const close = (model: ICellModel | null) => {
    clear(target);
    overlay.removeEventListener('click', click);
    overlay.removeEventListener('pointermove', pointermove);
    document.removeEventListener('keydown', keydown, true);
    overlay.remove();
    target = null;
    throttler.dispose();
    if (restore?.isConnected) restore.focus();
    else notebook.activeCell?.node.focus();
    delegate.resolve(model);
  };
  const reveal = async (cell: Cell<ICellModel> | null) => {
    if (cell) await notebook.scrollToCell(cell);
    requestAnimationFrame(claim);
  };
  const start = () => {
    if (!selectable.length) return null;

    const current = cells.findIndex(({ model }) => model.id === options.id);
    for (let index = current + 1; index < cells.length; ++index) {
      const cell = cells[index];
      if (usable(cell)) return cell;
    }
    for (let index = 0; index < current; ++index) {
      const cell = cells[index];
      if (usable(cell)) return cell;
    }
    return first;
  };
  const pick = (clientX: number, clientY: number) => {
    for (const cell of filter(cells, cell => cell.inViewport)) {
      const rect = cell.node.getBoundingClientRect();
      const overlap = clientY >= rect.y &&
        clientY <= rect.y + rect.height &&
        clientX >= rect.x &&
        clientX <= rect.x + rect.width;
      if (overlap) return cell;
    }
    return null;
  };
  const move = (step: -1 | 1) => {
    if (!selectable.length) return null;

    const current = target
      ? cells.indexOf(target)
      : cells.findIndex(({ model }) => model.id === options.id);
    for (
      let index = current + step;
      index >= 0 && index < cells.length;
      index += step
    ) {
      const cell = cells[index];
      if (usable(cell)) return cell;
    }
    if (usable(target)) return target;
    return step > 0 ? last : first;
  };
  const keydown = (event: KeyboardEvent) => {
    const { key } = event;
    if (key === 'Tab') {
      event.preventDefault();
      claim();
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(null);
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (usable(target)) close(target.model);
      return;
    }

    const cell = key === 'ArrowDown'
      ? move(1)
      : key === 'ArrowUp'
        ? move(-1)
        : key === 'Home'
          ? first
          : key === 'End'
            ? last
            : null;
    if (!cell) return;

    event.preventDefault();
    event.stopPropagation();
    set(cell);
    void reveal(cell);
  };
  const click = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const cell = pick(event.clientX, event.clientY);
    if (cell) set(cell);
    if (usable(target)) close(target.model);
  };
  const throttler = new Throttler(
    ({ clientX, clientY }: PointerEvent) => {
      const cell = pick(clientX, clientY);
      if (cell) set(cell);
    },
    { limit: 100 }
  );
  const pointermove = (event: PointerEvent) => {
    event.preventDefault();
    void throttler.invoke(event);
  };
  heading.className = `${PANEL}-title`;
  heading.id = `${PANEL}-title`;
  heading.textContent = options.title;
  overlay.classList.add(OVERLAY, 'cxt-mod-choose');
  overlay.setAttribute('aria-describedby', `${PANEL}-prompt ${PANEL}-status`);
  overlay.setAttribute('aria-labelledby', heading.id);
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('role', 'dialog');
  panel.className = PANEL;
  panel.tabIndex = -1;
  prompt.className = `${PANEL}-prompt`;
  prompt.id = `${PANEL}-prompt`;
  prompt.textContent = options.prompt;
  status.className = `${PANEL}-status`;
  status.id = `${PANEL}-status`;
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('role', 'status');
  panel.append(heading, prompt, status);
  overlay.appendChild(panel);
  notebook.viewportNode.appendChild(overlay);
  requestAnimationFrame(() => {
    set(start());
    overlay.addEventListener('pointermove', pointermove);
    overlay.addEventListener('click', click);
    document.addEventListener('keydown', keydown, true);
    void reveal(target);
  });
  return delegate.promise;
}

/** @returns text input from the user. */
export const text = async (options: InputDialog.ITextOptions) => {
  const { button, value } = await InputDialog.getText(options);
  return button.accept && value || '';
};
