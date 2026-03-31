import { IRenderMime } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ReactWidget } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit, Workbook } from '..';
import * as state from '../correxit/state';
import { Boundary, Sidebar } from '.';

export class SidebarWidget extends ReactWidget {
  constructor({ commands, monitor, settings, trans }: SidebarWidget.IOptions) {
    super();
    this.addClass('correxit-sidebar');
    this.commands = commands;
    this.trans = trans;
    state.refreshed.connect(this.update, this);
    void this.initialize(settings);
    void this.subscribe(monitor);
  }

  protected annotate = true;

  readonly trans: IRenderMime.TranslationBundle;

  protected commands: CommandRegistry;

  protected get workbook(): Workbook | null {
    return this.active;
  }
  protected set workbook(workbook: Workbook | null) {
    const previous = this.workbook;
    if (workbook === previous) return;
    this.active = workbook;
    if (workbook) {
      const notebook = workbook.context.model.sharedModel;
      notebook.metadataChanged.connect(this.update, this);
      workbook.context.fileChanged.connect(this.update, this);
      workbook.content?.activeCellChanged.connect(this.update, this);
    }
    if (previous) {
      const notebook = previous.context.model.sharedModel;
      notebook.metadataChanged.disconnect(this.update, this);
      previous.context.fileChanged.disconnect(this.update, this);
      previous.content?.activeCellChanged.disconnect(this.update, this);
    }
    this.update();
  }

  protected async initialize(pending: SidebarWidget.IOptions['settings']) {
    const settings = await pending;
    if (settings) {
      settings.changed.connect(
        ({ composite }) => void (this.annotate = !!composite.annotate)
      );
      this.annotate = !!settings.composite.annotate;
    }
  }

  protected render() {
    const { annotate, commands, trans, workbook } = this;
    const label = trans.__('Something went wrong rendering the sidebar.');
    const key = workbook ? workbook.context.path : 'idle';
    return (
      <Boundary key={key} label={label}>
        <Sidebar {...{ annotate, commands, trans, workbook }} />
      </Boundary>
    );
  }

  protected async subscribe(monitor: Correxit.Monitor) {
    for await (const workbook of monitor) {
      if (this.isDisposed) return;
      this.workbook = workbook;
    }
  }

  protected active: Workbook | null = null;
}

export namespace SidebarWidget {
  export interface IOptions {
    commands: CommandRegistry;
    monitor: Correxit.Monitor;
    settings: ReturnType<ISettingRegistry['load']> | null;
    trans: IRenderMime.TranslationBundle;
  }
}
