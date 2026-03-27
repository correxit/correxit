import { IRenderMime } from '@jupyterlab/rendermime';
import {
  ReactWidget,
  ToolbarButtonComponent,
  closeIcon
} from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import { Message } from '@lumino/messaging';
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

  onCloseRequest(msg: Message) {
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
  const { propagate, redistribute } = Correxit.CommandIDs;
  const [canceled, setCanceled] = useState(false);
  const [archived, setArchived] = useState<LogEntry[] | null>(null);
  const command = canceled ? '' : propagate;
  const [timestamp] = useState(Date.now);
  const [log, done] = useCommand<LogEntry>(commands, command, { timestamp });
  const [attempted, setAttempted] = useState(false);
  const [retry, setRetry] = useState<Propagator.Retry | null>(null);
  const [retries, setRetries] = useState<LogEntry[]>([]);
  const [started, setStarted] = useState(false);
  const recover = retry ? redistribute : '';
  const [extra, idle] = useCommand<LogEntry>(commands, recover, retry || {});
  useEffect(() => void (command && setAttempted(true)), [command]);
  useEffect(() => {
    if (done && attempted) release();
  }, [attempted, done, release]);
  useEffect(() => {
    if (!retry) {
      setStarted(false);
      return;
    }
    if (!idle || extra.length) setStarted(true);
  }, [extra.length, idle, retry]);
  useEffect(() => {
    if (!retry || !started || !idle) return;
    setRetries(current => [...current, ...extra]);
    setRetry(null);
  }, [extra, idle, retry, started]);

  const retrying = !!retry;
  const trail = [...log, ...retries, ...(retry ? extra : [])];
  const record = archived ?? trail;
  const messages = record
    .filter(([, { type }]) => type !== 'progress')
    .map(([message]) => message);
  const directory = record.find(([, { type }]) => type === 'mkdir')?.[1]
    .slots[0] as string | undefined;
  const saved = new Set(
    record
      .filter(([, { type }]) => type === 'saved')
      .map(([, { slots }]) => slots[0] as string)
  );
  const failed = Array.from(
    new Set(
      record
        .filter(([, { type }]) => type === 'distribute-error')
        .map(([, { slots }]) => slots[1] as string)
        .filter(path => saved.has(path))
    )
  );
  const start = retries
    .map(([, { type }]) => type === 'separator')
    .lastIndexOf(true);
  const recent = start === -1 ? [] : retries.slice(start);
  const retried = Array.from(
    new Set(
      recent
        .filter(([, { type }]) => type === 'distribute-error')
        .map(([, { slots }]) => slots[1] as string)
    )
  );
  const pending = retries.length ? retried : failed;
  const active = retrying ? extra : log;
  const [value, max]: [number, number] = active.reduce(
    (progress, [, { type, slots }]) =>
      type === 'progress' ? (slots as [number, number]) : progress,
    [0, 1]
  );
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  const running = !done || retrying;
  const retriable = done && (!!pending.length || retrying);
  const redo = () => {
    if (retrying || !directory || !pending.length) return;
    setRetry({ path: directory, timestamp: Date.now() });
  };
  const cancel = () => {
    setArchived(trail);
    setCanceled(true);
  };
  return (
    <div aria-busy={running} className="correxit-propagator-content">
      <div className="correxit-propagator-header">
        <span className="correxit-propagator-title">{title}</span>
        <ToolbarButtonComponent
          icon={closeIcon}
          onClick={close}
          tooltip={trans.__('Close')}
          noFocusOnClick
        />
      </div>
      <Log {...{ done, messages, trans }} />
      {done && canceled && (
        <span className="correxit-propagator-notice" role="status">
          {trans.__('Canceled.')}
        </span>
      )}
      {done && !canceled && !messages.length && (
        <span className="correxit-propagator-notice" role="status">
          {trans.__('No workbooks were created.')}
        </span>
      )}
      {running && (
        <div className="correxit-propagator-controls">
          <div className="correxit-propagator-progress">
            <progress
              aria-label={trans.__('Propagation progress')}
              {...{ max, value }}
            />
            <span>{trans.__('%1%', percent)}</span>
          </div>
          {!retrying && (
            <button
              className="correxit-propagator-button correxit-propagator-cancel"
              onClick={cancel}
            >
              {trans.__('Cancel')}
            </button>
          )}
        </div>
      )}
      {retriable && (
        <div className="correxit-propagator-controls">
          <button
            className="correxit-propagator-button correxit-propagator-retry"
            disabled={retrying}
            onClick={redo}
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

  export type Retry = {
    path: string;
    timestamp: number;
  };

  export type Widget = PropagatorWidget;
  export const Widget = PropagatorWidget;
}

const Log: React.FC<{
  done: boolean;
  messages: string[];
  trans: TranslationBundle;
}> = ({ done, messages, trans }) => {
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [messages.length]);
  if (done && !messages.length) return null;
  return (
    <pre
      aria-atomic="false"
      aria-busy={!done}
      aria-label={trans.__('Propagation log')}
      aria-live="polite"
      aria-relevant="additions text"
      ref={ref}
      role="log"
    >
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
