import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Rubric, Workbook } from '..';
import * as state from '../correxit/state';
import { Score } from './cell';
import { References } from './references';

type TranslationBundle = IRenderMime.TranslationBundle;

const { configure, correct, remove, share } = Correxit.CommandIDs;
const { get } = Rubric;

export const Body: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, trans, workbook }) => {
  const rubric = Workbook.open(workbook, true);
  const headed = !!workbook?.content;
  const active = headed
    ? workbook.content.activeCell?.model.id
    : state.cursor();
  if (!rubric || !active) {
    return (
      <section
        aria-label={trans.__('Cell controls')}
        className="correxit-sidebar-body"
      ></section>
    );
  }

  const id = active;

  const hints = {
    answerable: trans.__('Expected output has been set.'),
    comparable: trans.__('Cell output is compared against a reference.'),
    correctable: trans.__('Cell is corrected by reference cells.'),
    reference: trans.__('Selected cell is a reference cell.'),
    reviewable: trans.__('Cell is manually reviewed.')
  };
  const hint = get(rubric, id)?.is ?? (id in rubric.references && 'reference');
  return (
    <section
      aria-label={trans.__('Cell controls')}
      className="correxit-sidebar-body"
    >
      <div className="correxit-sidebar-cell-config">
        <CommandToolbarButtonComponent {...{ commands, id: correct }} />
        <CommandToolbarButtonComponent
          {...{ args: { id }, commands, id: correct }}
        />
      </div>
      <Score {...{ commands, id, rubric, trans, workbook }} />
      <div className="correxit-sidebar-cell-pair">
        <CommandToolbarButtonComponent
          {...{ args: { id, is: 'answerable' }, commands, id: configure }}
        />
        <CommandToolbarButtonComponent
          {...{ args: { id, is: 'reviewable' }, commands, id: configure }}
        />
        <CommandToolbarButtonComponent
          {...{ args: { id, is: 'comparable' }, commands, id: configure }}
        />
        <CommandToolbarButtonComponent
          {...{ args: { id, is: 'correctable' }, commands, id: configure }}
        />
        <CommandToolbarButtonComponent
          {...{ args: { id }, commands, id: remove }}
        />
      </div>
      <div className="correxit-sidebar-cell-actions">
        <CommandToolbarButtonComponent
          {...{ args: { id }, commands, id: share }}
        />
      </div>
      <References {...{ commands, id, rubric, trans, workbook }} />
      {hint && <p className="correxit-sidebar-cell-hint">{hints[hint]}</p>}
    </section>
  );
};
