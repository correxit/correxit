import { Widget } from '@lumino/widgets';
import React, { useEffect } from 'react';
import { Rubric, Workbook } from '..';
import * as state from '../correxit/state';

const correct = 'cxt-mod-correct';
const encrypted = 'cxt-mod-encrypted';
const incorrect = 'cxt-mod-incorrect';
const partial = 'cxt-mod-partial';
const decorations = Rubric.Cell.types
  .map(type => `cxt-mod-${type}`)
  .concat(correct, encrypted, incorrect, partial);

function clear({ content }: Workbook) {
  if (content && !content.isDisposed) content.widgets.forEach(reset);
}

function decorate(workbook: Workbook, cell: Rubric.Cell, widget: Widget) {
  const report = state.report(workbook, cell.id);
  widget.addClass(`cxt-mod-${cell.is}`);
  if (!report || report.status === 'unscored') return;
  if (report.code === 'locked') widget.addClass(partial);
  else if (report.points === cell.points) widget.addClass(correct);
  else if (report.points > 0) widget.addClass(partial);
  else widget.addClass(incorrect);
}

function reset(widget: Widget) {
  for (const decoration of decorations) widget.removeClass(decoration);
}

/**
 * A side-effect component that synchronizes rubric state with the notebook UI.
 *
 * This component renders `null` but uses Lumino's widget API to apply visual
 * indicators to workbook cells based on their status in the rubric (e.g.,
 * 'correct', 'incorrect', etc.).
 *
 * Its lifecycle is bound to the Correxit sidebar: when mounted, it augments
 * the active notebook if it is a workbook. When unmounted or updated, it
 * cleans up and restores widgets to their original state.
 */
export const Annotate: React.FC<{ workbook: Workbook | null }> = props => {
  const { workbook } = props;
  const rubric = Workbook.open(workbook, true);
  useEffect(() => {
    const notebook = workbook?.content;
    if (!notebook || !rubric || notebook.isDisposed) return;

    const sealed = rubric.locked && !!rubric.assignment.seal;
    const secrets = rubric.locked
      ? new Set(
          Object.values(rubric.references)
            .filter(({ secret }) => secret)
            .map(({ referent }) => referent)
        )
      : null;
    let remaining = Rubric.size(rubric) + (secrets?.size || 0);
    for (const widget of notebook.widgets) {
      const { id } = widget.model;
      const cell = Rubric.get(rubric, id);
      if (cell) {
        decorate(workbook, cell, widget);
        if (sealed) widget.addClass(encrypted);
        remaining--;
      }
      if (secrets?.has(id)) {
        widget.addClass(encrypted);
        remaining--;
      }
      if (remaining === 0) break;
    }
    return () => clear(workbook);
  }, [rubric, workbook]);
  return null;
};
