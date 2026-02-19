import { MainAreaWidget } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButton,
  ReactWidget,
  Toolbar,
  ToolbarButton,
  ToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { ISignal, Signal } from '@lumino/signaling';
import React from 'react';
import { Correxit } from '..';
import { Corrector } from '.';

export class CorrectorWidget extends MainAreaWidget<Content> {
  constructor({ commands, path, trans }: CorrectorWidget.IOptions) {
    super({ content: new Content({ commands, path, trans }) });
    this.commands = commands;
    this.trans = trans;
    this.addClass('correxit-corrector-widget');
    void this.initialize();
  }

  get path(): string {
    return this.content.path;
  }
  set path(path: string) {
    this.content.set({ correct: false, path: PathExt.normalize(path) });
    this.commands.notifyCommandChanged(Corrector.CommandIDs.cd);
  }

  get certify(): boolean {
    return this.content.certify;
  }

  set certify(value: boolean) {
    this.content.set({ certify: value });
  }

  protected commands: CommandRegistry;
  protected trans: IRenderMime.TranslationBundle;

  protected async initialize() {
    const { commands, content, toolbar, trans } = this;
    let status = ReactWidget.create(<></>);
    const notify = (updates: { graded: boolean; scanned: boolean }) => {
      const { graded, scanned } = updates;
      const current = scanned
        ? graded
          ? trans.__('Idle')
          : trans.__('Correcting...')
        : trans.__('Scanning...');
      status.dispose();
      status = ReactWidget.create(<span>{current}</span>);
      toolbar.insertItem(6, 'status', status);
    };
    const cd = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.cd,
      noFocusOnClick: true
    });
    const correct = new ToolbarButton({
      icon: Correxit.Icons.correct,
      label: trans.__('Correct workbooks'),
      tooltip: trans.__('Correct all workbooks in directory'),
      noFocusOnClick: true,
      onClick: () => content.set({ correct: true })
    });
    const refresh = new CommandToolbarButton({
      args: { hard: true },
      commands,
      id: Corrector.CommandIDs.refresh,
      noFocusOnClick: true
    });
    const certify = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.certify,
      label: '',
      noFocusOnClick: true
    });
    const toggle = (unlock: boolean) => content.set({ correct: false, unlock });
    const passphrase = new UnlockButton({ toggle, trans });
    content.toggled.connect((_, locked) => passphrase.set(locked));
    toolbar.addItem('cd', cd);
    toolbar.addItem('refresh', refresh);
    toolbar.addItem('passphrase', passphrase);
    toolbar.addItem('spacer', Toolbar.createSpacerItem());
    toolbar.addItem('certify', certify);
    toolbar.addItem('correct', correct);
    toolbar.addItem('status', status);
    content.set({ notify });
  }
}

export namespace CorrectorWidget {
  export interface IOptions {
    commands: CommandRegistry;
    path: string;
    trans: IRenderMime.TranslationBundle;
  }
}

class Content extends ReactWidget {
  constructor(props: Pick<Corrector.Props, 'commands' | 'path' | 'trans'>) {
    super();
    this.props = {
      ...props,
      certify: false,
      correct: false,
      notify: () => {},
      unlock: false
    };
    this.addClass('correxit-corrector-widget-content');
  }

  get certify(): boolean {
    return this.props.certify;
  }

  get path(): string {
    return this.props.path || '';
  }

  get toggled(): ISignal<Content, boolean> {
    return this._toggled;
  }

  set(updates: Partial<Corrector.Props & { key?: string }>) {
    if (updates.path !== undefined) {
      updates = { ...updates, unlock: false, key: `${Date.now()}` };
    }
    this.props = { ...this.props, ...updates };
    if (updates.unlock !== undefined) {
      this._toggled.emit(!updates.unlock);
    }
    this.update();
  }

  render() {
    return <Corrector {...this.props} />;
  }

  protected props: Corrector.Props & { key?: string };
  private _toggled = new Signal<Content, boolean>(this);
}

class UnlockButton extends ReactWidget {
  constructor(options: {
    toggle: (unlock: boolean) => void;
    trans: IRenderMime.TranslationBundle;
  }) {
    super();
    this.toggle = options.toggle;
    this.trans = options.trans;
  }

  render() {
    const { locked, toggle, trans } = this;
    return (
      <ToolbarButtonComponent
        className="jp-Button jp-mod-minimal"
        onClick={() => toggle(locked)}
        icon={locked ? Correxit.Icons.key : Correxit.Icons.locked}
        iconLabel={
          locked ? trans.__('Unlock workbooks') : trans.__('Lock workbooks')
        }
      />
    );
  }

  set(locked: boolean) {
    if (locked !== this.locked) {
      this.locked = locked;
      this.update();
    }
  }

  protected locked = true;
  protected toggle: (unlock: boolean) => void;
  protected trans: IRenderMime.TranslationBundle;
}
