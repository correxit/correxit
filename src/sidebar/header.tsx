import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButtonComponent,
  UseSignal
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';
import { Sidebar } from './sidebar';

export const Header: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ commands, trans, workbook }) => {
  const { convert, correct, lock, unlock } = Sidebar.CommandIDs;
  return (
    <section className="correxit-header">
      <File trans={trans} workbook={workbook} />
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <ID trans={trans} workbook={workbook} />
      <CommandToolbarButtonComponent commands={commands} id={lock} />
      <CommandToolbarButtonComponent commands={commands} id={unlock} />
      <CommandToolbarButtonComponent commands={commands} id={correct} />
    </section>
  );
};

const File: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  const { content, context } = workbook;
  const heading = content.model?.getMetadata('correxit')
    ? trans.__('Workbook file:')
    : trans.__('Notebook file:');
  return (
    <UseSignal signal={context.pathChanged} initialSender={context}>
      {() => (
        <>
          <h4>{heading}</h4>
          <div className="correxit-monospace">
            {PathExt.basename(context.path)}
          </div>
        </>
      )}
    </UseSignal>
  );
};

const ID: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  const id = workbook.content.model?.getMetadata('correxit')?.id;
  if (!id) {
    return <></>;
  }
  return (
    <>
      <h4>{trans.__('Workbook ID:')}</h4>
      <div className="correxit-monospace" title={id}>
        {id}
      </div>
    </>
  );
};
