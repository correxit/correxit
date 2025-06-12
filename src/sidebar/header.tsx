import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import { UseSignal } from '@jupyterlab/ui-components';
import React from 'react';
import { Correxit } from '../correxit';

const BLANKSPACE = String.fromCharCode(8207);

export const Header: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  return (
    <section className="correxit-header">
      <File trans={trans} workbook={workbook} />
      <ID trans={trans} workbook={workbook} />
      <Key trans={trans} workbook={workbook} />
    </section>
  );
};

const File: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  const { context } = workbook;
  return (
    <>
      <h4>{trans.__('Workbook file:')}</h4>
      <UseSignal signal={context.pathChanged} initialSender={context}>
        {() => (
          <div className="correxit-path">{PathExt.basename(context.path)}</div>
        )}
      </UseSignal>
    </>
  );
};

const ID: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  const id = workbook.content.model?.getMetadata('correxit')?.id || BLANKSPACE;
  return (
    <>
      <h4>{trans.__('Workbook ID:')}</h4>
      <div className="correxit-digest" title={id}>
        {id}
      </div>
    </>
  );
};

const Key: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  const key = Correxit.Rubric.get(workbook)?.key || BLANKSPACE;
  return (
    <>
      <h4>{trans.__('Workbook private key:')}</h4>
      <div className="correxit-digest" title={key}>
        {key}
      </div>
    </>
  );
};
