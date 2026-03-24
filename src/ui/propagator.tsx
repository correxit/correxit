import { IRenderMime } from '@jupyterlab/rendermime';
import {
  ReactWidget,
  ToolbarButtonComponent,
  closeIcon
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useRef, useState } from 'react';
import { Correxit } from '..';
import type { Emission } from '../correxit/propagator';
import { useCommand } from '../correxit/use-command';

type LogEntry = [string, Emission];
type TranslationBundle = IRenderMime.TranslationBundle;
type Options = Omit<Propagator.Props, 'close' | 'title'>;

class PropagatorWidget extends ReactWidget {
  constructor(protected readonly options: Options) {
    super();
    this.addClass('correxit-propagator');
  }

  dispose() {
    this.options.release();
    super.dispose();
  }

  onCloseRequest(msg: import('@lumino/messaging').Message) {
    super.onCloseRequest(msg);
    this.options.refocus();
  }

  protected render() {
    const close = () => this.close();
    const title = this.title.caption;
    return <Propagator {...{ ...this.options, close, title }} />;
  }
}

export function Propagator(props: Propagator.Props) {
  const { close, commands, release, title, trans } = props;
  const { distribute, propagate } = Correxit.CommandIDs;
  const [cancelled, setCancelled] = useState(false);
  const command = cancelled ? '' : propagate;
  const [timestamp] = useState(Date.now);
  const [log, done] = useCommand<LogEntry>(commands, command, { timestamp });
  const [attempted, setAttempted] = useState(false);
  const [retried, setRetried] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [updates, setUpdates] = useState<string[]>([]);
  useEffect(() => void (command && setAttempted(true)), [command]);
  useEffect(() => {
    if (done && attempted) release();
  }, [attempted, done, release]);

  const messages = [
    ...log
      .filter(([, { type }]) => type !== 'progress')
      .map(([message]) => message),
    ...updates
  ];
  const saved = new Set(
    log
      .filter(([, { type }]) => type === 'saved')
      .map(([, { slots }]) => slots[0] as string)
  );
  const failed = Array.from(
    new Set(
      log
        .filter(([, { type }]) => type === 'distribute-error')
        .map(([, { slots }]) => slots[1] as string)
        .filter(path => saved.has(path))
    )
  );
  const pending = failed.filter(path => !retried.includes(path));
  const [value, max]: [number, number] = log.reduce(
    (progress, [, { type, slots }]) =>
      type === 'progress' ? (slots as [number, number]) : progress,
    [0, 1]
  );
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  const retry = async () => {
    if (retrying || !pending.length) return;
    setRetrying(true);

    const recovered: string[] = [];
    const fresh: string[] = [];
    for (const path of pending) {
      const ok = await commands.execute(distribute, {
        path,
        quiet: true,
        silent: true
      });
      if (ok) {
        recovered.push(path);
        fresh.push(trans.__('Distributed %1', path));
      } else {
        fresh.push(trans.__('Distribution pending %1', path));
      }
    }
    if (fresh.length)
      setUpdates(current => [...current, '------------', ...fresh]);

    if (recovered.length) setRetried(current => [...current, ...recovered]);

    setRetrying(false);
  };
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
          {!!pending.length && (
            <button
              className="correxit-propagator-cancel"
              disabled={retrying}
              onClick={() => void retry()}
            >
              {retrying
                ? trans.__('Retrying...')
                : trans.__('Retry %1 failed', pending.length)}
            </button>
          )}
          <button
            className="correxit-propagator-cancel"
            onClick={() => setCancelled(true)}
          >
            {trans.__('Cancel')}
          </button>
        </div>
      )}
      {done && !!pending.length && (
        <div className="correxit-propagator-controls">
          <button
            className="correxit-propagator-cancel"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying
              ? trans.__('Retrying...')
              : trans.__('Retry %1 failed', pending.length)}
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
    refocus: () => void;
    release: () => void;
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
  if (done && !messages.length) return null;
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
