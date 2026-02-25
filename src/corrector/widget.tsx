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
    this.selector?.reset();
    this.commands.notifyCommandChanged(Corrector.CommandIDs.cd);
  }

  dispose() {
    this.indicator?.set({ graded: true, scanned: true });
    super.dispose();
  }

  protected commands: CommandRegistry;
  protected indicator: CorrectorStatus | null;
  protected selector: ModeSelector | null = null;
  protected trans: IRenderMime.TranslationBundle;

  protected async initialize() {
    const { commands, content, indicator, toolbar, trans } = this;
    const go = (mode: Corrector.Mode) =>
      content.set({ active: true, key: `${Date.now()}`, mode });
    const interrupt = () => content.set({ active: false });
    const selector = new ModeSelector({ go, interrupt, trans });
    const notify = (updates: Corrector.Notification) => {
      indicator?.set(updates);
      selector?.set(updates);
    };
    const cd = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.cd,
      noFocusOnClick: true
    });
    this.selector = selector;
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
    interrupt: () => void;
    trans: IRenderMime.TranslationBundle;
  }) {
    super();
    this.go = options.go;
    this.interrupt = options.interrupt;
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
    const { busy, go, interrupt, mode, trans } = this;
    const modes: { label: string; tooltip: string; value: Corrector.Mode }[] = [
      {
        value: 'scan',
        label: trans.__('Scan'),
        tooltip: trans.__('Scan for workbooks, leave them locked')
      },
      {
        value: 'unlock',
        label: trans.__('Scan & Unlock'),
        tooltip: trans.__('Scan for workbooks, unlock them')
      },
      {
        value: 'grade',
        label: trans.__('Grade'),
        tooltip: trans.__('Unlock and grade workbooks (read-only, no save)')
      },
      {
        value: 'certify',
        label: trans.__('Grade & Certify'),
        tooltip: trans.__('Unlock workbooks and collect grades, (save file)')
      }
    ];

    const action = busy ? interrupt : () => go(mode);
    const label = busy ? trans.__('Interrupt') : trans.__('Go');
    const className = `correxit-corrector-mode-go ${
      busy ? 'jp-mod-warn' : 'jp-mod-accept'
    }`;
    const description = busy
      ? trans.__('Interrupt the current operation')
      : trans.__('Execute selected mode');

    return (
      <>
        <fieldset
          className="correxit-corrector-mode-options"
          aria-label={trans.__('Corrector mode')}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          {modes.map(({ label, tooltip, value }) => (
            <label key={value} title={tooltip}>
              <input
                type="radio"
                name="correxit-mode"
                value={value}
                checked={mode === value}
                onChange={() => this.select(value)}
                aria-label={label}
                aria-description={tooltip}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        <button className={className} onClick={action} aria-label={description}>
          {label}
        </button>
      </>
    );
  }

  reset() {
    this.select('scan');
  }

  set(updates: Corrector.Notification) {
    const idle = updates.graded && updates.scanned;
    this.busy = !idle && updates.mode !== 'scan';
    this.update();
  }

  private select(mode: Corrector.Mode) {
    this.mode = mode;
    this.update();
  }

  protected busy = false;
  protected go: (mode: Corrector.Mode) => void;
  protected interrupt: () => void;
  protected mode: Corrector.Mode = 'scan';
  protected trans: IRenderMime.TranslationBundle;
}
