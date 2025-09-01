import { IRenderMime } from '@jupyterlab/rendermime';
import { ReactWidget } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { Signal } from '@lumino/signaling';
import React from 'react';
import { Correxit, Workbook } from '..';
import { Sidebar } from '.';

export class SidebarWidget extends ReactWidget {
  constructor({ commands, source, trans }: SidebarWidget.IOptions) {
    super();
    this.addClass('correxit-sidebar');
    this.commands = commands;
    this.trans = trans;
    void this.subscribe(source);
  }

  readonly trans: IRenderMime.TranslationBundle;

  protected commands: CommandRegistry;

  protected pinged = new Signal<unknown, void>(this);

  protected get workbook(): Workbook.Headed | null {
    return this._workbook;
  }
  protected set workbook(workbook: Workbook.Headed | null) {
    if (workbook === this.workbook) {
      return;
    }

    const previous = this.workbook;
    this._workbook = workbook;
    if (workbook) {
      const { model } = workbook.context;
      model.sharedModel.metadataChanged.connect(this.ping, this);
      workbook.context.fileChanged.connect(this.ping, this);
    }
    if (previous) {
      const { model } = previous.context;
      model.sharedModel.metadataChanged.disconnect(this.ping, this);
      previous.context.fileChanged.disconnect(this.ping, this);
    }
    this.update();
  }

  protected ping() {
    this.pinged.emit(void 0);
  }

  protected render() {
    const { commands, trans, workbook } = this;
    if (workbook === null) {
      return (
        <section>
          <small>{trans.__('Correxit: idle, waiting for notebook')}</small>
        </section>
      );
    }

    return (
      <Sidebar
        {...{ commands, trans, workbook }}
        sender={this}
        signal={this.pinged}
      />
    );
  }

  protected async subscribe(source: Correxit.Source) {
    for await (const { payload } of source) {
      if (this.isDisposed) {
        return;
      }
      this.workbook = payload;
    }
  }

  private _workbook: Workbook.Headed | null = null;
}

export namespace SidebarWidget {
  export interface IOptions {
    commands: CommandRegistry;
    source: Correxit.Source;
    trans: IRenderMime.TranslationBundle;
  }
}
