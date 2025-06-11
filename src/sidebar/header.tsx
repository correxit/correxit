import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import { UseSignal } from '@jupyterlab/ui-components';
import React from 'react';
import { Correxit } from '../correxit';

export const Header: React.FC<{
  trans: IRenderMime.TranslationBundle;
  workbook: Correxit.Workbook;
}> = ({ trans, workbook }) => {
  return (
    <section className="correxit-header">
      <File trans={trans} workbook={workbook} />
      <ID trans={trans} workbook={workbook} />
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
  const model = workbook.content.model!;
  const key = model!.cells.get(0).id;
  return (
    <>
      <h4>{trans.__('Workbook ID:')}</h4>
      <UseSignal key={key} signal={model.metadataChanged} initialSender={model}>
        {() => {
          const { model } = workbook.content;
          const blank = String.fromCharCode(8207);
          const id = model?.getMetadata('correxit')?.id || blank;
          return (
            <div className="correxit-digest" title={id}>
              {id}
            </div>
          );
        }}
      </UseSignal>
    </>
  );
};
