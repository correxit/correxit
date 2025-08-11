import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButtonComponent,
  UseSignal
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Workbook } from '..';

export const Header: React.FC<{
  commands: CommandRegistry;
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook;
}> = ({ commands, trans, workbook }) => {
  const { convert, correct, lock, unlock } = Correxit.CommandIDs;
  return (
    <section className="correxit-header">
      <File trans={trans} workbook={workbook} />
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <CommandToolbarButtonComponent commands={commands} id={lock} />
      <CommandToolbarButtonComponent commands={commands} id={unlock} />
      <CommandToolbarButtonComponent commands={commands} id={correct} />
    </section>
  );
};

const File: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Workbook;
}> = ({ trans, workbook }) => {
  const quiet = true;
  const rubric = Workbook.open(workbook, quiet);
  const { context } = workbook;
  const heading = rubric
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
