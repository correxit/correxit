import React, { useEffect } from 'react';
import { Rubric, Workbook } from '..';
import * as state from '../correxit/state';

/**
 * A side-effect component that synchronizes rubric state with the notebook UI.
 *
 * This component renders `null` but manipulates the active notebook's DOM to
 * apply visual indicators to workbook cells based on their status in the rubric
 * (e.g., 'correct', 'incorrect', etc.).
 *
 * Its lifecycle is bound to the Correxit sidebar: when mounted, it augments the
 * active notebook if it is a workbook. When unmounted or updated, it cleans up
 * and restores the notebook DOM to its original state.
 */
export const Annotate: React.FC<{ workbook: Workbook | null }> = props => {
  const { workbook } = props;
  const notebook = workbook?.content;
  const rubric = Workbook.open(workbook, true);
  const classes = Rubric.Cell.types.map(type => `cxt-mod-${type}`);
  const selector = Rubric.Cell.types.map(type => `.cxt-mod-${type}`).join(', ');
  useEffect(() => {
    const status = ['cxt-mod-correct', 'cxt-mod-incorrect'];
    const reset = (node: Element) => {
      node.classList.remove(...classes);
      node.classList.remove(...status);
    };
    const clear = () =>
      void notebook?.node.querySelectorAll(selector).forEach(reset);
    if (!notebook || notebook.isDisposed || !rubric) {
      return clear;
    }

    let remaining = Rubric.size(rubric);
    for (const { node, model } of notebook.widgets) {
      const cell = Rubric.get(rubric, model.id);
      if (!cell) {
        continue;
      }
      node.classList.add(`cxt-mod-${cell.is}`);

      const report = state.report(workbook, cell.id);
      const [correct, incorrect] = status;
      if (report?.status === 'correct') {
        node.classList.add(correct);
      } else if (report?.status === 'incorrect') {
        node.classList.add(incorrect);
      }
      if (--remaining === 0) {
        break;
      }
    }
    return clear;
  }, [notebook, rubric]);
  return null;
};
