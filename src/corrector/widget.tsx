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
import React, { useRef } from 'react';
import { Correxit } from '..';
import { Corrector } from '.';

const PATH_KEY = 'correxit-corrector:path';

export class CorrectorWidget extends MainAreaWidget<Content> {
  constructor({ commands, db, path, trans }: CorrectorWidget.IOptions) {
    super({ content: new Content({ commands, path, trans }) });
    this.commands = commands;
    this.db = db;
    this.addClass('correxit-corrector-widget');

    let status = ReactWidget.create(<></>);
    const initialize = async () => {
      const path = (await db.fetch(PATH_KEY)) as string;
      if (path) {
        this.path = path;
      }
    };
    const notify = (scanned: boolean, corrected: boolean) => {
      const current = scanned
        ? corrected
          ? trans.__('Idle')
          : trans.__('Correcting...')
        : trans.__('Scanning...');
      status.dispose();
      status = ReactWidget.create(<span>{current}</span>);
      toolbar.insertItem(5, 'status', status);
    };
    const { content, toolbar } = this;
    const cd = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.cd
    });
    const correct = new ToolbarButton({
      icon: Correxit.Icons.correct,
      label: trans.__('Correct workbooks'),
      tooltip: trans.__('Correct all workbooks in directory'),
      onClick: () => content.set({ correct: true })
    });
    const enter = (passphrase: string) =>
      content.set({ correct: false, passphrase });
    const passphrase = ReactWidget.create(<Passphrase {...{ enter, trans }} />);
    const refresh = new CommandToolbarButton({
      commands,
      id: Corrector.CommandIDs.refresh
    });
    toolbar.addItem('cd', cd);
    toolbar.addItem('refresh', refresh);
    toolbar.addItem('passphrase', passphrase);
    toolbar.addItem('spacer', Toolbar.createSpacerItem());
    toolbar.addItem('correct', correct);
    toolbar.addItem('status', status);
    content.set({ notify });
    void initialize();
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
  }

  get path(): string {
    return this.props.path;
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
  const { enter, trans } = props;
  const icon = Correxit.Icons.key;
  const input = useRef<HTMLInputElement>(null);
  const onSubmit: React.FormEventHandler = event => {
    event.preventDefault();
    event.stopPropagation();
    if (input.current) {
      enter(input.current.value);
      input.current.value = '';
    }
  };
  const id = 'correxit-corrector-passphrase';
  const placeholder = trans.__('Enter passphrase');
  return (
    <form {...{ onSubmit }}>
      <label htmlFor={id} className="sr-only">
        {trans.__('Passphrase')}
      </label>
      <input {...{ id, placeholder }} ref={input} type="password" />
      <button type="submit" className="jp-Button jp-mod-minimal">
        <icon.react tag="span" title={trans.__('Unlock workbooks')} />
      </button>
    </form>
  );
};
