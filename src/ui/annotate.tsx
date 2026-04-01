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
 * Synchronizes rubric state with the active notebook UI.
 *
 * The component does two kinds of work. Imperatively, it stamps notebook cells
 * with transient classes for rubric role, grading state, and encryption.
 * Declaratively, it renders a scoped stylesheet whose rules draw connector
 * geometry for the active cell's reference group.
 *
 * Lifecycle is bound to the Correxit sidebar. On mount and update it replays
 * the current decorations against the active notebook. On cleanup it removes
 * the classes and notebook scope it owns. Static annotation styling lives in
 * CSS; only the connector topology is synthesized here from notebook order.
 */
export const Annotate: React.FC<{ workbook: Workbook | null }> = props => {
  const { workbook } = props;
  const rubric = Workbook.open(workbook, true);
  const notebook = workbook?.content;
  const active = notebook?.activeCell?.model.id || null;
  const layout = JSON.stringify(notebook?.widgets.map(({ model }) => model.id));
  const scope = rubric ? track(rubric.id) : null;
  const linked = active && rubric ? referents(rubric, active) : [];
  const order = notebook
    ? new Map(notebook.widgets.map(({ model }, i) => [model.id, i] as const))
    : null;
  const css =
    active && scope && order ? rules(scope, active, linked, order) : '';
  useEffect(() => {
    if (!notebook || !rubric || notebook.isDisposed) return;

    const marks: Marks = {
      notebook,
      scope: null,
      widgets: new Map()
    };
    const ids = new Set([
      ...Object.keys(rubric.cells),
      ...Object.values(rubric.references).map(({ referent }) => referent)
    ]);
    for (const widget of notebook.widgets) {
      const { id } = widget.model;
      if (!ids.has(id)) continue;
      mark(marks, widget, stamp(id));
      const cell = Rubric.get(rubric, id);
      if (cell) decorate(marks, workbook, cell, widget);
      if (security.encrypted(widget.model.sharedModel.getSource()))
        mark(marks, widget, encrypted);
    }
    if (scope && css) {
      notebook.addClass(scope);
      marks.scope = scope;
    }
    return () => clear(marks);
  }, [active, css, layout, notebook, rubric, scope, workbook]);
  return <style>{css}</style>;
};

type Marks = {
  notebook: Workbook['content'];
  scope: string | null;
  widgets: Map<Widget, Set<string>>;
};

function clear(marks: Marks) {
  const { notebook, scope, widgets } = marks;
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
): string {
  const group = [active, ...linked]
    .filter(id => order.has(id))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  if (group.length < 2) return '';

  const lane =
    'calc(var(--jp-cell-padding) + var(--jp-cell-collapser-width) / 2 - 1px)';
  const tone = 'var(--jp-brand-color1)';
  const cap = (id: string, y: string) =>
    id === active
      ? ''
      : `
    .jp-Notebook.${scope} .jp-Cell.${stamp(id)} {
      background-image: linear-gradient(to right, ${tone}, ${tone});
      background-position: ${lane} ${y};
      background-repeat: no-repeat;
      background-size: 10px 1px;
    }
  `;
  const editor = (id: string) =>
    `.jp-Notebook.${scope} .jp-Cell.${stamp(id)} .jp-InputArea-editor`;
  const endpoints = group.map(editor).join(',\n');
  const head = group[0];
  const tail = group[group.length - 1];
  const gap = order.get(tail)! - order.get(head)!;
  const floor = tail === active ? 'var(--jp-cell-padding)' : '0';
  const first = `.jp-Notebook.${scope} .jp-Cell.${stamp(head)}`;
  const last = `.jp-Notebook.${scope} .jp-Cell.${stamp(tail)}`;
  const middle =
    gap < 2 ? '' : `${first} ~ .jp-Cell:not(${last}):not(${last} ~ .jp-Cell)`;
  const span = [first, middle, last].filter(Boolean);
  const chain = span.join(',\n');
  const bars = span.map(selector => `${selector}::before`).join(',\n');
  const gutters = span.map(selector => `${selector} .jp-Collapser`).join(',\n');
  return `
    ${chain} { position: relative; }
    ${gutters} {
      position: relative;
      z-index: 1;
    }
    ${endpoints} { box-shadow: inset 2px 0 0 ${tone}; }
    ${bars} {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: ${lane};
      width: 1px;
      border-radius: 999px;
      background: repeating-linear-gradient(
        to bottom,
        ${tone},
        ${tone} 2px,
        transparent 2px,
        transparent 6px
      );
      opacity: 0.7;
      z-index: 0;
      pointer-events: none;
    }
    ${first}::before { top: var(--jp-cell-padding); }
    ${last}::before { bottom: ${floor}; }
    ${cap(head, 'var(--jp-cell-padding)')}
    ${cap(tail, 'calc(100% - 1px)')}
  `;
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
