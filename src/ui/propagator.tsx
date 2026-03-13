import { IRenderMime } from '@jupyterlab/rendermime';
import {
  ReactWidget,
  ToolbarButtonComponent,
  closeIcon
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useRef, useState } from 'react';
import { Correxit } from '..';
import { useCommand } from '../correxit/use-command';

type TranslationBundle = IRenderMime.TranslationBundle;

class PropagatorWidget extends ReactWidget {
  constructor({ commands, title, trans }: PropagatorWidget.IOptions) {
    super();
    this.addClass('correxit-propagator');
    this.commands = commands;
    this._title = title;
    this.trans = trans;
  }

  protected render() {
    const { commands, trans } = this;
    const close = () => this.close();
    const title = this._title;
    return <Propagator {...{ close, commands, title, trans }} />;
  }

  private commands: CommandRegistry;
  private _title: string;
  private trans: TranslationBundle;
}

namespace PropagatorWidget {
  export interface IOptions {
    commands: CommandRegistry;
    title: string;
    trans: TranslationBundle;
  }
}

export function Propagator({
  close,
  commands,
  title,
  trans
}: Propagator.Props) {
  type Message = [string, Correxit.Emitter.Emission];
  const { propagate } = Correxit.CommandIDs;
  const [cancelled, setCancelled] = useState(false);
  const [started] = useState(Date.now);
  const [log, done] = useCommand<Message>(
    commands,
    cancelled ? '' : propagate,
    { timestamp: started }
  );
  const messages = log
    .filter(([, { type }]) => type !== 'progress')
    .map(([message]) => message);
  const [value, max]: [number, number] = log.reduce(
    (progress, [, { type, slots }]) =>
      type === 'progress' ? (slots as [number, number]) : progress,
    [0, 1]
  );
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="correxit-propagator-content">
      <div className="correxit-propagator-header">
        <span className="correxit-propagator-title">{title}</span>
        <ToolbarButtonComponent
          icon={closeIcon}
          onClick={close}
          tooltip={trans.__('Close')}
          noFocusOnClick
        />
      </div>
      <Log {...{ done, messages }} />
      {done && !messages.length && (
        <span className="correxit-propagator-notice">
          {cancelled
            ? trans.__('Cancelled.')
            : trans.__('No workbooks were created.')}
        </span>
      )}
      {!done && (
        <div className="correxit-propagator-controls">
          <div className="correxit-propagator-progress">
            <progress {...{ max, value }} />
            <span>{trans.__('%1%', percent)}</span>
          </div>
          <button
            className="correxit-propagator-cancel"
            onClick={() => setCancelled(true)}
          >
            {trans.__('Cancel')}
          </button>
        </div>
      )}
    </div>
  );
}

export namespace Propagator {
  export type Props = {
    close: () => void;
    commands: CommandRegistry;
    title: string;
    trans: TranslationBundle;
  };

  export type Widget = PropagatorWidget;
  export const Widget = PropagatorWidget;
}

const Log: React.FC<{
  done: boolean;
  messages: string[];
}> = ({ done, messages }) => {
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);
  if (done && !messages.length) return <></>;
  return (
    <pre ref={ref}>
      {messages.map((message, key) => (
        <Emission {...{ key, message }} />
      ))}
    </pre>
  );
};

const Emission: React.FC<{ message: string }> = React.memo(({ message }) => (
  <span title={message}>
    {message}
    <br />
  </span>
));
