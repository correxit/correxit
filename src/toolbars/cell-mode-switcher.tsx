import { Cell } from '@jupyterlab/cells';
import { NotebookPanel } from '@jupyterlab/notebook';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButtonComponent,
  UseSignal
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Rubric, Workbook } from '..';

type TranslationBundle = IRenderMime.TranslationBundle;

export const CellModeSwitcher: React.FC<{
  cell: Cell;
  commands: CommandRegistry;
  trans: TranslationBundle;
}> = ({ cell: { model, parent }, commands, trans }) => {
  const { id } = model;
  const workbook = parent?.parent instanceof NotebookPanel && parent.parent;
  if (!workbook || !workbook.model) {
    return <></>;
  }

  const { sharedModel } = workbook.model;
  const switcher = () => <Switcher {...{ commands, id, trans, workbook }} />;
  return <UseSignal signal={sharedModel.metadataChanged}>{switcher}</UseSignal>;
};

const Switcher: React.FC<{
  commands: CommandRegistry;
  id: string;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, id, trans, workbook }) => {
  if (!commands.isEnabled(Correxit.CommandIDs.add, { id })) {
    return <></>;
  }
  const { add } = Correxit.CommandIDs;
  const buttons: CommandToolbarButtonComponent.IProps[] = [
    { commands, id: add, args: { id, is: 'answerable' }, label: '' },
    { commands, id: add, args: { id, is: 'correctable' }, label: '' },
    { commands, id: add, args: { id, is: 'comparable' }, label: '' }
  ];
  return (
    <div className="x-gap">
      {buttons.map((props, index) => (
        <CommandToolbarButtonComponent key={index} {...props} />
      ))}
    </div>
  );
};

export const PermanenetCellMode: React.FC<{
  cell: Cell;
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
}> = ({ cell: { model, parent }, commands, trans }) => {
  const { id } = model;
  const workbook = parent?.parent instanceof NotebookPanel && parent.parent;
  if (!workbook || !workbook.model) {
    return <></>;
  }

  const { sharedModel } = workbook.model;
  const permanent = () => <Permanent {...{ commands, id, trans, workbook }} />;
  return (
    <UseSignal signal={sharedModel.metadataChanged}>{permanent}</UseSignal>
  );
};

const Permanent: React.FC<{
  commands: CommandRegistry;
  id: string;
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook;
}> = ({ commands, id, trans, workbook }) => {
  if (!commands.isEnabled(Correxit.CommandIDs.add, { id })) {
    return <></>;
  }
  const { add } = Correxit.CommandIDs;
  let buttons: CommandToolbarButtonComponent.IProps[] = [];

  const quiet = true;
  const rubric = Workbook.open(workbook, quiet)!;
  const is = Rubric.get(rubric, id)?.is;

  if (is === 'answerable') {
    buttons = [
      { commands, id: add, args: { id, is: 'answerable' }, label: '' }
    ];
  } else if (is === 'comparable') {
    buttons = [
      { commands, id: add, args: { id, is: 'comparable' }, label: '' }
    ];
  } else if (is === 'correctable') {
    buttons = [
      { commands, id: add, args: { id, is: 'correctable' }, label: '' }
    ];
  }

  return (
    <div className="x-gap">
      {buttons.map((props, index) => (
        <CommandToolbarButtonComponent key={index} {...props} />
      ))}
    </div>
  );
};
