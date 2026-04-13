import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Rubric, Workbook } from '..';

type TranslationBundle = IRenderMime.TranslationBundle;

const { dereference, refer } = Correxit.CommandIDs;
const { get } = Rubric;

export const References: React.FC<{
  commands: CommandRegistry;
  id: string;
  rubric: Rubric;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, id, rubric, trans, workbook }) => {
  const cell = get(rubric, id);
  if (!cell) return <></>;
  if (cell.is !== 'comparable' && cell.is !== 'correctable') return <></>;

  const references = Object.values(rubric.references).filter(
    reference => reference.cell === id
  );
  if (!references.length && rubric.locked) return <></>;

  const correctable = cell.is === 'correctable';
  const editable = !rubric.locked && !rubric.assignment.assignee;
  const notebook = Workbook.headed(workbook) ? workbook.content : null;
  const source = (referent: string) => {
    const cell = notebook?.widgets.find(({ model }) => model.id === referent);
    return cell?.model.sharedModel.getSource().split('\n')[0] ?? '';
  };
  const scroll = (referent: string) => {
    if (!notebook) return;
    const cell = notebook.widgets.find(({ model }) => model.id === referent);
    if (cell) void notebook.scrollToCell(cell);
  };
  const sources = references.map(reference => ({
    ...reference,
    source: source(reference.referent)
  }));

  return (
    <div className="correxit-sidebar-references">
      <h5>{trans.__('References (%1)', references.length)}</h5>
      <ul className="correxit-sidebar-references-list">
        {sources.map(({ points, referent, source }) => (
          <li className="correxit-sidebar-reference-item" key={referent}>
            <button
              className="correxit-sidebar-reference-locate"
              onClick={() => scroll(referent)}
              title={referent}
              type="button"
            >
              {referent.slice(0, 4)}
            </button>
            <span className="correxit-sidebar-reference-source" title={source}>
              {source}
            </span>
            {correctable && (
              <span
                className={'correxit-sidebar-reference-points'}
                title={trans.__('Points')}
              >
                {trans.__('%1pt', points)}
              </span>
            )}
            {editable && (
              <CommandToolbarButtonComponent
                {...{
                  args: { referent },
                  commands,
                  id: dereference,
                  label: ''
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <CommandToolbarButtonComponent
          {...{ args: { id }, commands, id: refer }}
        />
      )}
    </div>
  );
};
