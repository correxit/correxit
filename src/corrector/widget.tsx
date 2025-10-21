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
import React, { useEffect, useState } from 'react';
import { Correxit } from '..';
import { Corrector } from '.';
import { ISignal, Signal } from '@lumino/signaling';

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
    const toggleUnlock = (unlock: boolean) =>
      content.set({ correct: false, unlock });
    const passphrase = ReactWidget.create(
      <Unlock
        {...{
          trans,
          toggleUnlock,
          lockedChanged: this.content.lockedChanged
        }}
      />
    );
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
      correct: false,
      notify: () => {},
      unlock: false,
      updateLocked: this.updateLocked
    };
    this.addClass('correxit-corrector-widget-content');
  }

  get path(): string {
    return this.props.path || '';
  }

  /**
   * Trigger the change of lock state.
   */
  updateLocked = (value: boolean) => {
    this._lockedChanged.emit(value);
  };

  /**
   * A signal emitting when the locked state changed.
   */
  get lockedChanged(): ISignal<Content, boolean> {
    return this._lockedChanged;
  }

  set(updates: Partial<Corrector.Props>) {
    // Set the content as locked before locking/unlocking.
    if (updates.unlock !== undefined) {
      this.updateLocked(true);
    }
    // Prevent triggering the unlock when changing directory.
    if (updates.path !== undefined) {
      this.props.unlock = false;
    }
    this.props = { ...this.props, ...updates, key: `${Date.now()}` };
    this.update();
  }

  render() {
    return <Corrector {...this.props} />;
  }

  protected props: Corrector.Props & { key?: string };
  private _lockedChanged = new Signal<Content, boolean>(this);
}

const Unlock: React.FC<{
  toggleUnlock: (unlock: boolean) => void;
  trans: IRenderMime.TranslationBundle;
  lockedChanged: ISignal<Content, boolean>;
}> = props => {
  const { trans } = props;
  const [locked, setLocked] = useState(true);
  const unlockIcon = Correxit.Icons.key;
  const lockIcon = Correxit.Icons.locked;

  useEffect(() => {
    props.lockedChanged.connect((_, value) => {
      setLocked(value);
    });
  }, [props.lockedChanged]);

  return (
    <ToolbarButtonComponent
      className="jp-Button jp-mod-minimal"
      onClick={() => {
        props.toggleUnlock(locked);
      }}
      icon={locked ? unlockIcon : lockIcon}
      iconLabel={
        locked ? trans.__('Unlock workbooks') : trans.__('Lock workbooks')
      }
    />
  );
};
