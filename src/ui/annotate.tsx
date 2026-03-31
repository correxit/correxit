import { Widget } from '@lumino/widgets';
import React, { useEffect } from 'react';
import { Rubric, Workbook } from '..';
import * as security from '../correxit/security';
import * as state from '../correxit/state';

const correct = 'cxt-mod-correct';
const encrypted = 'cxt-mod-encrypted';
const incorrect = 'cxt-mod-incorrect';
const partial = 'cxt-mod-partial';

/**
 * A side-effect component that synchronizes rubric state with the notebook UI.
 *
 * Renders `null` but uses Lumino's widget API to apply visual indicators to
 * workbook cells based on their rubric status (correct, incorrect, etc.).
 *
 * Lifecycle is bound to the Correxit sidebar: on mount, it augments the active
 * notebook if it is a workbook. On unmount or update, it cleans up and
 * restores widgets to their original state.
 */
export const Annotate: React.FC<{ workbook: Workbook | null }> = props => {
  const { workbook } = props;
  const rubric = Workbook.open(workbook, true);
  const notebook = workbook?.content;
  const active = notebook?.activeCell?.model.id || null;
  const layout = JSON.stringify(notebook?.widgets.map(({ model }) => model.id));
  useEffect(() => {
    if (!notebook || !rubric || notebook.isDisposed) return;

    const marks: Marks = {
      notebook,
      scope: null,
      style: null,
      widgets: new Map()
    };
    const references = referents(rubric, active);
    const ids = new Set([
      ...Object.keys(rubric.cells),
      ...Object.values(rubric.references).map(({ referent }) => referent)
    ]);
    const index = new Map(
      notebook.widgets.map((widget, i) => [widget.model.id, i] as const)
    );

    for (const widget of notebook.widgets) {
      const { id } = widget.model;
      if (!ids.has(id)) continue;
      mark(marks, widget, stamp(id));
      const cell = Rubric.get(rubric, id);
      if (cell) decorate(marks, workbook, cell, widget);
      if (security.encrypted(widget.model.sharedModel.getSource()))
        mark(marks, widget, encrypted);
    }
    if (active && references.length) {
      const scope = track(rubric.id);
      notebook.addClass(scope);
      marks.scope = scope;

      const css = rules(scope, active, references, index);
      if (css) {
        const style = document.createElement('style');
        style.textContent = css;
        notebook.node.appendChild(style);
        marks.style = style;
      }
    }

    return () => clear(marks);
  }, [active, layout, notebook, rubric, workbook]);
  return null;
};

type Marks = {
  notebook: Workbook['content'];
  scope: string | null;
  style: HTMLStyleElement | null;
  widgets: Map<Widget, Set<string>>;
};

function clear(marks: Marks) {
  const { notebook, scope, style, widgets } = marks;
  if (style) style.remove();
  if (scope && notebook && !notebook.isDisposed) notebook.removeClass(scope);

  widgets.forEach((decorations, widget) => {
    if (widget.isDisposed) return;
    decorations.forEach(decoration => widget.removeClass(decoration));
  });
}

function decorate(
  marks: Marks,
  workbook: Workbook,
  cell: Rubric.Cell,
  widget: Widget
) {
  const report = state.report(workbook, cell.id);
  mark(marks, widget, `cxt-mod-${cell.is}`);
  if (!report || report.status === 'unscored') return;
  if (report.code === 'locked') mark(marks, widget, partial);
  else if (report.points === cell.points) mark(marks, widget, correct);
  else if (report.points > 0) mark(marks, widget, partial);
  else mark(marks, widget, incorrect);
}

function mark(marks: Marks, widget: Widget, decoration: string) {
  const decorations = marks.widgets.get(widget) || new Set<string>();
  if (decorations.has(decoration)) return;
  widget.addClass(decoration);
  decorations.add(decoration);
  marks.widgets.set(widget, decorations);
}

function referents(rubric: Rubric, id: string | null): string[] {
  if (!id) return [];
  const cells = Object.values(rubric.cells);
  const group = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.pop()!;
    const cell = Rubric.get(rubric, current);
    const linked =
      cell && (cell.is === 'comparable' || cell.is === 'correctable')
        ? cell.references
        : cells
            .filter(cell => cell.references?.includes(current))
            .map(cell => cell.id);
    for (const peer of linked) {
      if (group.has(peer)) continue;
      group.add(peer);
      queue.push(peer);
    }
  }
  group.delete(id);
  return Array.from(group);
}

function rules(
  scope: string,
  active: string,
  linked: string[],
  order: Map<string, number>
) {
  const group = [active, ...linked]
    .filter(id => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  if (group.length < 2) return '';

  const editor = (id: string) =>
    `.jp-Notebook.${scope} .jp-Cell.${stamp(id)} .jp-InputArea-editor`;
  const endpoints = group.map(editor).join(',\n');
  const head = group[0];
  const tail = group[group.length - 1];
  const first = `.jp-Notebook.${scope} .jp-Cell.${stamp(head)}`;
  const last = `.jp-Notebook.${scope} .jp-Cell.${stamp(tail)}`;
  const sibling = `${first} ~ .jp-Cell:not(${last} ~ .jp-Cell)`;

  return [
    `${endpoints} {
  box-shadow: inset 2px 0 0 var(--correxit-insistent-color);
}`,
    `${first}::before,
${sibling}::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 10px;
  width: 1px;
  border-radius: 999px;
  background: var(--correxit-insistent-color);
  opacity: 0.28;
  pointer-events: none;
}`,
    `${first}::before {\n  top: calc(50% + 1px);\n}`,
    `${last}::before {\n  bottom: calc(50% + 1px);\n}`
  ].join('\n');
}

function stamp(id: string) {
  return `cxt-cell-${token(id)}`;
}

function token(id: string) {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

function track(id: string) {
  return `cxt-scope-${token(id)}`;
}
