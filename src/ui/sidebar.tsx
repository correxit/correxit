import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Workbook } from '..';
import { Annotate } from './annotate';
import { Body } from './body';
import { Header } from './header';
import { SidebarWidget } from './widget';

type TranslationBundle = IRenderMime.TranslationBundle;

const { reset } = Correxit.CommandIDs;

export function Sidebar(props: Sidebar.Props) {
  const { annotate, commands, trans, workbook } = props;
  return (
    <>
      <Annotate {...{ workbook: annotate ? workbook : null }} />
      <Header {...{ commands, trans, workbook }} />
      {workbook && (
        <>
          <Body {...{ commands, trans, workbook }} />
          <section className="correxit-sidebar-footer">
            <CommandToolbarButtonComponent commands={commands} id={reset} />
          </section>
        </>
      )}
    </>
  );
}

export namespace Sidebar {
  export type Props = {
    annotate: boolean;
    commands: CommandRegistry;
    trans: TranslationBundle;
    workbook: Workbook | null;
  };
  export type Widget = SidebarWidget;
  export const Widget = SidebarWidget;
}
