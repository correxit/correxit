import { IRenderMime } from '@jupyterlab/rendermime';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { ReactWidget, UseSignal } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { Signal } from '@lumino/signaling';
import React from 'react';
import { Correxit } from '../correxit';
import { Body } from './body';
import { Footer } from './footer';
import { Header } from './header';

export class Sidebar extends ReactWidget {
  constructor({ commands, source, translator }: Sidebar.IOptions) {
    super();
    this.addClass('correxit');
    this.commands = commands;
    this.trans = (translator || nullTranslator).load('correxit');
    void this.subscribe(source);
  }

  readonly trans: IRenderMime.TranslationBundle;

  public get workbook(): Correxit.Workbook | null {
    return this._workbook;
  }
  protected set workbook(workbook: Correxit.Workbook | null) {
    if (this._workbook === workbook) {
      return;
    }
    if (this._workbook) {
      this._workbook.context.fileChanged.disconnect(this.ping, this);
      this._workbook.content.model?.metadataChanged.disconnect(this.ping, this);
    }
    this._workbook = workbook;
    if (this._workbook) {
      this._workbook.context.fileChanged.connect(this.ping, this);
      this._workbook.content.model?.metadataChanged.connect(this.ping, this);
    }
    this.update();
  }

  protected commands: CommandRegistry;

  protected pinged = new Signal<unknown, undefined>(this);

  protected ping() {
    this.pinged.emit(undefined);
  }

  protected render() {
    const { commands, trans, workbook } = this;
    if (workbook === null || workbook.content.model === null) {
      return (
        <section>
          <small>[{trans.__('correxit idle, waiting for notebook')}]</small>
        </section>
      );
    }
    const key = workbook.content.model.cells.get(0).id;
    return (
      <UseSignal key={key} signal={this.pinged} initialSender={this}>
        {() => (
          <>
            <Header commands={commands} trans={trans} workbook={workbook} />
            <Body commands={commands} trans={trans} workbook={workbook} />
            <Footer commands={commands} />
          </>
        )}
      </UseSignal>
    );
  }

  protected async subscribe(source: Sidebar.IOptions['source']) {
    for await (const { payload } of source) {
      if (this.isDisposed) {
        return;
      }
      this.workbook = payload;
    }
  }

  private _workbook: Correxit.Workbook | null = null;
}

export namespace Sidebar {
  export interface IOptions {
    commands: CommandRegistry;
    source: AsyncIterable<{ payload: Correxit.Workbook | null }>;
    translator?: ITranslator | null;
  }
}
