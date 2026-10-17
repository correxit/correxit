import { CommandRegistry } from '@lumino/commands';
import { Correxit, Rubric, Workbook } from '..';
import { retain } from '../correxit/state';
import { Draft } from './draft';

/** The React-facing interface; lifecycle belongs to the sidebar widget. */
export type Editor = {
  id: string;
  key: string;
  read: () => Draft.State;
  subscribe: (listener: () => void) => () => void;
  edit: (update: Partial<Draft.Fields>) => void;
  select: (update: Partial<Draft.Fields>) => void;
  retry: () => void;
};

type Tracked = Editor & {
  dispose: () => void;
  observe: (assignment: Rubric.Assignment, locked: boolean) => void;
};

const DELAY = 150;

/** Own drafts for visited notebook views, including while they are inactive. */
export function create(commands: CommandRegistry) {
  const drafts = new Map<Workbook, Tracked>();
  const open = (workbook: Workbook | null): Editor | null => {
    if (!workbook) return null;
    const cached = drafts.get(workbook);
    const rubric =
      workbook.context.isDisposed || workbook.content?.isDisposed
        ? null
        : Workbook.open(workbook, true);
    if (rubric && cached?.id === rubric.id) {
      cached.observe(rubric.assignment, rubric.locked);
      return cached;
    }
    cached?.dispose();
    if (!rubric) return null;

    const { id } = rubric;
    const context = Workbook.headless(workbook) ? retain(workbook) : null;
    let locked = rubric.locked;
    let state = Draft.create(rubric.assignment);
    let delay: number | null = null;
    const listeners = new Set<() => void>();
    const current = () => {
      if (workbook.context.isDisposed || drafts.get(workbook) !== editor)
        return null;
      const rubric = Workbook.open(workbook, true);
      return rubric?.id === id && !rubric.locked ? rubric : null;
    };
    const update = (next: Draft.State) => {
      if (state === next) return;
      state = next;
      if (delay !== null) window.clearTimeout(delay);
      delay = null;
      if (current() && Draft.pending(state))
        delay = window.setTimeout(() => void persist(), DELAY);
      listeners.forEach(listener => listener());
    };
    const persist = async () => {
      const rubric = current();
      if (!rubric) return;
      const next = Draft.begin(state, rubric.assignment);
      if (next.phase !== 'saving' || next.save === state.save)
        return update(next);

      const { save } = next;
      update(next);
      const result = await commands
        .execute(Correxit.CommandIDs.assign, {
          ...save.changes,
          path: workbook.context.path,
          context: context?.id ?? null,
          view: workbook.content?.id ?? null,
          rubric: id
        })
        .catch(() => null);
      update(
        Draft.complete(state, save, !!result, current()?.assignment ?? null)
      );
    };
    const notebook = workbook.context.model.sharedModel;
    const refresh = () => {
      const rubric = Workbook.open(workbook, true);
      if (!rubric || rubric.id !== id) return editor.dispose();
      editor.observe(rubric.assignment, rubric.locked);
    };
    const editor: Tracked = {
      id,
      key: workbook.content?.id ?? context!.id,
      dispose: () => {
        if (drafts.get(workbook) !== editor) return;
        if (delay !== null) window.clearTimeout(delay);
        notebook.metadataChanged.disconnect(refresh);
        workbook.context.disposed.disconnect(editor.dispose);
        workbook.content?.disposed.disconnect(editor.dispose);
        context?.dispose();
        drafts.delete(workbook);
        listeners.clear();
      },
      read: () => state,
      subscribe: listener => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      edit: fields => update(Draft.edit(state, fields)),
      select: fields => update(Draft.select(state, fields)),
      retry: () => update(Draft.retry(state)),
      observe: (assignment, next) => {
        const reset = locked || next;
        locked = next;
        update(
          reset ? Draft.create(assignment) : Draft.observe(state, assignment)
        );
      }
    };
    drafts.set(workbook, editor);
    // Cached drafts must observe lock transitions even while their view is inactive.
    notebook.metadataChanged.connect(refresh);
    workbook.context.disposed.connect(editor.dispose);
    workbook.content?.disposed.connect(editor.dispose);
    return editor;
  };

  return {
    open,
    dispose: () => drafts.forEach(editor => editor.dispose())
  };
}
