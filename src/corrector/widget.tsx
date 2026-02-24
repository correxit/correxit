import { MainAreaWidget } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import {
  CommandToolbarButton,
  ReactWidget,
  Toolbar
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Corrector } from '.';
import { Message } from '@lumino/messaging';

export class CorrectorWidget extends MainAreaWidget<Content> {
  constructor({ commands, indicator, path, trans }: CorrectorWidget.IOptions) {
    super({ content: new Content({ commands, path, trans }) });
    this.commands = commands;
    this.indicator = indicator;
    this.trans = trans;
    this.addClass('correxit-corrector-widget');
    void this.initialize();
  }

  get path(): string {
    return this.content.path;
  }
  set path(path: string) {
    this.content.set({ path: PathExt.normalize(path) });
    this.modes?.reset();
    this.commands.notifyCommandChanged(Corrector.CommandIDs.cd);
  }

  dispose() {
    this.indicator?.set({ graded: true, scanned: true });
    super.dispose();
  }

  protected commands: CommandRegistry;
  protected indicator: CorrectorStatus | null;
  protected modes: ModeSelector | null = null;
  protected trans: IRenderMime.TranslationBundle;

  protected async initialize() {
    const { commands, content, indicator, toolbar, trans } = this;
    const notify = (updates: { graded: boolean; scanned: boolean }) =>
      indicator?.set(updates);
    const cd = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.cd,
      noFocusOnClick: true
    });
    const go = (mode: Corrector.Mode) =>
      content.set({ active: true, key: `${Date.now()}`, mode });
    const selector = new ModeSelector({ go, trans });
    this.modes = selector;
    toolbar.addItem('cd', cd);
    toolbar.addItem('spacer', Toolbar.createSpacerItem());
    toolbar.addItem('mode', selector);
    content.set({ notify });
  }
}

export namespace CorrectorWidget {
  export interface IOptions {
    commands: CommandRegistry;
    indicator: CorrectorStatus | null;
    path: string;
    trans: IRenderMime.TranslationBundle;
  }
}

export class CorrectorStatus extends ReactWidget {
  constructor(trans: IRenderMime.TranslationBundle) {
    super();
    this.trans = trans;
    this.addClass('correxit-corrector-status');
  }

  render() {
    const { graded, scanned, trans } = this;
    const label = !scanned
      ? trans.__('Scanning...')
      : !graded
        ? trans.__('Grading...')
        : trans.__('Idle');
    return <span className="jp-StatusBar-TextItem">{label}</span>;
  }

  set(updates: { graded: boolean; scanned: boolean }) {
    this.graded = updates.graded;
    this.scanned = updates.scanned;
    this.update();
  }

  protected graded = true;
  protected scanned = true;
  protected trans: IRenderMime.TranslationBundle;
}

class Content extends ReactWidget {
  constructor(props: Pick<Corrector.Props, 'commands' | 'path' | 'trans'>) {
    super();
    this.props = {
      ...props,
      active: false,
      mode: 'scan',
      notify: () => {}
    };
    this.addClass('correxit-corrector-widget-content');
  }

  get path(): string {
    return this.props.path || '';
  }

  set(updates: Partial<Corrector.Props & { key?: string }>) {
    if (updates.path !== undefined) {
      updates = { ...updates, active: false, key: `${Date.now()}` };
    }
    this.props = { ...this.props, ...updates };
    this.update();
  }

  render() {
    return <Corrector {...this.props} />;
  }

  protected props: Corrector.Props & { key?: string };
}

class ModeSelector extends ReactWidget {
  constructor(options: {
    go: (mode: Corrector.Mode) => void;
    trans: IRenderMime.TranslationBundle;
  }) {
    super();
    this.go = options.go;
    this.trans = options.trans;
    this.addClass('correxit-corrector-mode');
  }

  handleEvent(event: Event): void {
    event.stopPropagation();
  }

  protected onBeforeAttach(msg: Message): void {
    super.onBeforeAttach(msg);
    this.node.addEventListener('click', this);
    this.node.removeEventListener('pointerdown', this);
  }

  protected onAfterDetach(msg: Message): void {
    super.onAfterDetach(msg);
    this.node.removeEventListener('click', this);
    this.node.removeEventListener('pointerdown', this);
  }

  render() {
    const { go, mode, trans } = this;
    const modes: { label: string; value: Corrector.Mode }[] = [
      { value: 'scan', label: 'Scan' },
      { value: 'unlock', label: 'Scan & Unlock' },
      { value: 'grade', label: 'Grade' },
      { value: 'certify', label: 'Grade & Certify' }
    ];
    return (
      <>
        <span
          className="correxit-corrector-mode-options"
          role="group"
          aria-label={trans.__('Corrector mode')}
        >
          {modes.map(({ value, label }) => (
            <label key={value}>
              <input
                type="radio"
                name="correxit-mode"
                value={value}
                checked={mode === value}
                onChange={() => this.select(value)}
              />
              <span>{trans.__(label)}</span>
            </label>
          ))}
        </span>
        <button
          className="correxit-corrector-mode-go jp-mod-accept"
          onClick={() => go(mode)}
        >
          {trans.__('Go')}
        </button>
      </>
    );
  }

  reset() {
    this.select('scan');
  }

  private select(mode: Corrector.Mode) {
    this.mode = mode;
    this.update();
  }

  protected go: (mode: Corrector.Mode) => void;
  protected mode: Corrector.Mode = 'scan';
  protected trans: IRenderMime.TranslationBundle;
}
