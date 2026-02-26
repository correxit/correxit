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

  protected async initialize() {
    const { commands, content, indicator, toolbar, trans } = this;
    const go = (mode: Corrector.Mode, overwrite: boolean) =>
      content.set({ key: `${Date.now()}`, mode, overwrite });
    const selector = new ModeSelector({ go, trans });
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

  protected commands: CommandRegistry;
  protected indicator: CorrectorStatus | null;
  protected selector: ModeSelector | null = null;
  protected trans: IRenderMime.TranslationBundle;
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
      mode: 'scan',
      notify: () => {},
      overwrite: false
    };
    this.addClass('correxit-corrector-widget-content');
  }

  get path(): string {
    return this.props.path || '';
  }

  set(updates: Partial<Corrector.Props & { key?: string }>) {
    if (updates.path !== undefined) {
      updates = { ...updates, mode: 'scan', key: `${Date.now()}` };
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
    go: (mode: Corrector.Mode, overwrite: boolean) => void;
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
    const { busy, mode, overwrite, trans } = this;
    const modes: { label: string; tooltip: string; value: Corrector.Mode }[] = [
      {
        value: 'scan',
        label: trans.__('Scan'),
        tooltip: trans.__('Scan for workbooks, leave them locked')
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
    const action = () => this.go(mode, overwrite);
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
        <label
          className="correxit-corrector-overwrite"
          title={trans.__('Re-certify already certified workbooks')}
        >
          <input
            type="checkbox"
            checked={overwrite}
            disabled={mode !== 'certify'}
            onChange={({ target }) => this.set({ overwrite: target.checked })}
            aria-label={trans.__('Overwrite already certified workbooks')}
          />
          <span>{trans.__('Overwrite')}</span>
        </label>
        <button className={className} onClick={action} aria-label={description}>
          {label}
        </button>
      </>
    );
  }

  reset() {
    this.select('scan');
    this.busy = false;
    this.overwrite = false;
    this.update();
  }

  set(updates: Corrector.Notification | { overwrite: boolean }) {
    if ('overwrite' in updates) {
      this.overwrite = updates.overwrite;
    } else {
      this.busy = !(updates.graded && updates.scanned);
    }
    this.update();
  }

  protected busy = false;
  protected go: (mode: Corrector.Mode, overwrite: boolean) => void;
  protected overwrite = false;
  protected mode: Corrector.Mode = 'scan';
  protected trans: IRenderMime.TranslationBundle;

  protected select(mode: Corrector.Mode) {
    Corrector.Modes.forEach(mode => this.removeClass(`cxt-mod-${mode}`));
    this.addClass(`cxt-mod-${mode}`);
    this.mode = mode;
    this.update();
  }
}
