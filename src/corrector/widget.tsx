import { MainAreaWidget } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMime } from '@jupyterlab/rendermime';
import { IStateDB } from '@jupyterlab/statedb';
import {
  CommandToolbarButton,
  ReactWidget,
  Toolbar,
  ToolbarButton
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useRef, useState } from 'react';
import { Correxit } from '..';
import { Corrector } from '.';

const PATH_KEY = 'correxit-corrector:path';

export class CorrectorWidget extends MainAreaWidget<Content> {
  constructor({ commands, db, path, trans }: CorrectorWidget.IOptions) {
    super({ content: new Content({ commands, path, trans }) });
    this.commands = commands;
    this.db = db;
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
    void this.db.save(PATH_KEY, path);
  }

  protected commands: CommandRegistry;
  protected db: IStateDB;
  protected trans: IRenderMime.TranslationBundle;

  protected async initialize() {
    const { commands, content, db, toolbar, trans } = this;
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
      toolbar.insertItem(5, 'status', status);
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
    const enter = (passphrase: string) =>
      content.set({ correct: false, passphrase });
    const passphrase = ReactWidget.create(<Passphrase {...{ enter, trans }} />);
    const refresh = new CommandToolbarButton({
      args: { hard: true },
      commands,
      id: Corrector.CommandIDs.refresh,
      noFocusOnClick: true
    });
    toolbar.addItem('cd', cd);
    toolbar.addItem('refresh', refresh);
    toolbar.addItem('passphrase', passphrase);
    toolbar.addItem('spacer', Toolbar.createSpacerItem());
    toolbar.addItem('correct', correct);
    toolbar.addItem('status', status);
    content.set({ notify });

    const path = (await db.fetch(PATH_KEY)) as string;
    if (path) {
      this.path = path;
    }
  }
}

export namespace CorrectorWidget {
  export interface IOptions {
    commands: CommandRegistry;
    db: IStateDB;
    path: string;
    trans: IRenderMime.TranslationBundle;
  }
}

class Content extends ReactWidget {
  constructor(props: Pick<Corrector.Props, 'commands' | 'path' | 'trans'>) {
    super();
    this.props = { ...props, correct: false, notify: () => {}, passphrase: '' };
    this.addClass('correxit-corrector-widget-content');
  }

  get path(): string {
    return this.props.path || '';
  }

  set(updates: Partial<Corrector.Props>) {
    this.props = { ...this.props, ...updates, key: `${Date.now()}` };
    this.update();
  }

  render() {
    return <Corrector {...this.props} />;
  }

  protected props: Corrector.Props & { key?: string };
}

const Passphrase: React.FC<{
  trans: IRenderMime.TranslationBundle;
  enter: (passphrase: string) => void;
}> = props => {
  const { trans } = props;
  const [entered, setEntered] = useState(false);
  const icon = Correxit.Icons.key;
  const input = useRef<HTMLInputElement>(null);
  const id = 'correxit-corrector-passphrase';
  const placeholder = entered
    ? trans.__('Update in-memory passphrase')
    : trans.__('Apply passphrase to workbooks');
  const size = 32;
  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        event.stopPropagation();
        const value = input.current?.value;
        if (value) {
          input.current.value = '';
          input.current.blur();
          props.enter(value);
          setEntered(true);
        }
      }}
    >
      <label htmlFor={id} className="sr-only">
        {trans.__('Passphrase')}
      </label>
      <input {...{ id, placeholder, size }} ref={input} type="password" />
      <button type="submit" className="jp-Button jp-mod-minimal">
        <icon.react tag="span" title={trans.__('Unlock workbooks')} />
      </button>
    </form>
  );
};
