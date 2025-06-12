import {
  CommandToolbarButtonComponent,
  UseSignal
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { Sidebar } from './sidebar';

export const Footer: React.FC<{
  commands: CommandRegistry;
  workbook: Correxit.Workbook;
}> = ({ commands, workbook }) => {
  const { convert, lock, reset, unlock } = Sidebar.CommandIDs;
  const { model } = workbook.content;
  if (model === null) {
    return <section></section>;
  }
  const key = model.cells.get(0).id;
  return (
    <UseSignal key={key} signal={model.metadataChanged} initialSender={model}>
      {() => (
        <section className="correxit-footer">
          <CommandToolbarButtonComponent commands={commands} id={convert} />
          <CommandToolbarButtonComponent commands={commands} id={lock} />
          <CommandToolbarButtonComponent commands={commands} id={unlock} />
          <CommandToolbarButtonComponent commands={commands} id={reset} />
        </section>
      )}
    </UseSignal>
  );
};
