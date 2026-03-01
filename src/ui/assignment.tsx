import { IRenderMime } from '@jupyterlab/rendermime';
import { checkIcon, ToolbarButtonComponent } from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useRef, useState } from 'react';
import { Correxit, Rubric } from '..';
import { useCommand } from '../correxit/use-command';
import { Toggle } from './toggle';

type Assignment = Rubric.Assignment;
type TranslationBundle = IRenderMime.TranslationBundle;

const { assign, registrar } = Correxit.CommandIDs;

export const Assignment: React.FC<{
  commands: CommandRegistry;
  rubric: Rubric;
  trans: TranslationBundle;
}> = ({ commands, rubric, trans }) => {
  const { locked, revised } = rubric;
  const [assignment, setAssignment] = useState<Assignment>(rubric.assignment);
  const [registered, setRegistered] = useState<string[] | null>(null);
  const [view, setView] = useState<'assignee' | 'roster'>('assignee');
  const toggle = (to: 'assignee' | 'roster', updated: Assignment) => {
    setAssignment(updated);
    setView(to);
  };
  const reassign = async (assignment: Assignment, locked: boolean) =>
    void (!locked && commands.execute(assign, assignment).catch(_ => {}));
  const request = async () => setRegistered(await commands.execute(registrar));
  const freeze = (roster: string[]) =>
    setAssignment(assignment => ({ ...assignment, roster }));
  useEffect(() => void request(), [rubric]);
  useEffect(() => void (registered && freeze(registered)), [registered]);
  useEffect(() => setAssignment(rubric.assignment), [rubric]);
  useEffect(() => void reassign(assignment, locked), [assignment]);
  return (
    <div className="correxit-assignment">
      {view === 'assignee' ? (
        <Assignee {...{ assignment, locked, toggle, trans }} />
      ) : (
        <Roster {...{ assignment, locked, registered, toggle, trans }} />
      )}
      <Expiration {...{ assignment, locked, toggle, trans }} />
      {!locked && <Propagate {...{ commands, revised, trans }} />}
    </div>
  );
};

const Assignee: React.FC<{
  assignment: Assignment;
  locked: boolean;
  toggle: (to: 'assignee' | 'roster', assignment: Assignment) => void;
  trans: TranslationBundle;
}> = ({ assignment, locked, toggle, trans }) => {
  const unassigned = trans.__('Template - unassigned');
  const { assignee, roster } = assignment;
  if (locked) {
    const { Icons } = Correxit;
    const assignee = assignment.assignee || unassigned;
    const icon = assignment.assignee ? Icons.assignee : Icons.template;
    return (
      <div className="correxit-assignment-assignee">
        <Toggle disabled icon={icon} title={trans.__('Roster view')} />
        <div className="correxit-monospace">{assignee}</div>
      </div>
    );
  }
  return (
    <div className="correxit-assignment-assignee">
      <Toggle
        {...{
          icon: Correxit.Icons.roster,
          title: trans.__('Roster view'),
          toggle: () => toggle('roster', assignment)
        }}
      />
      <div>
        <select
          name="correxit-assignment-assignee"
          onChange={({ target: { value } }) =>
            toggle('assignee', { ...assignment, assignee: value })
          }
          value={assignee}
        >
          <option value="">
            {roster.length
              ? trans.__('Template - unassigned (roster: %1)', roster.length)
              : trans.__('Template - unassigned (roster: empty)')}
          </option>
          {roster.map((value, key) => (
            <option {...{ key, value }}>{value}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

const format = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const Expiration: React.FC<{
  assignment: Assignment;
  locked: boolean;
  toggle: (to: 'assignee' | 'roster', assignment: Assignment) => void;
  trans: TranslationBundle;
}> = ({ assignment, locked, toggle, trans }) => {
  const { expiration } = assignment;
  const className =
    expiration !== null && Date.now() > expiration
      ? 'correxit-assignment-expiration cxt-mod-expired'
      : 'correxit-assignment-expiration';
  if (locked) {
    const label = expiration
      ? trans.__('Due %1', new Date(expiration).toLocaleString())
      : trans.__('No deadline');
    return (
      <div className={className}>
        <div className="correxit-monospace">{label}</div>
      </div>
    );
  }
  const update = (value: string) => {
    const expiration = value ? new Date(value).getTime() : null;
    toggle('assignee', { ...assignment, expiration });
  };
  return (
    <div className={className}>
      <div>
        <label htmlFor="correxit-assignment-expiration">
          {trans.__('Deadline')}
        </label>
        <input
          id="correxit-assignment-expiration"
          name="correxit-assignment-expiration"
          onChange={({ target: { value } }) => update(value)}
          type="datetime-local"
          value={expiration ? format(expiration) : ''}
        />
      </div>
    </div>
  );
};

const Roster: React.FC<{
  assignment: Assignment;
  locked: boolean;
  registered: string[] | null;
  toggle: (to: 'assignee' | 'roster', assignment: Assignment) => void;
  trans: TranslationBundle;
}> = ({ assignment: seed, locked, registered, toggle, trans }) => {
  const id = 'correxit-assignment-roster';
  const [assignment, setAssignment] = useState<Assignment>(seed);
  const [value, setValue] = useState<string>(assignment.roster.join('\n'));
  const roster = value.split('\n').filter(Boolean);
  const freeze = (roster: string[]) => setValue(roster.join('\n'));
  useEffect(() => void (registered && freeze(registered)), [registered]);
  useEffect(
    () =>
      setAssignment(({ assignee, ...assignment }) => {
        assignee = find(roster, record => record === assignee) ? assignee : '';
        return { ...assignment, assignee, roster };
      }),
    [roster]
  );
  if (locked) return <></>;
  return (
    <div className="correxit-assignment-roster">
      <Toggle
        {...{
          icon: checkIcon,
          title: trans.__('Assignee view'),
          toggle: () => toggle('assignee', assignment)
        }}
      />
      <div>
        <label htmlFor={id}>
          {trans.__('Assignment roster (line-separated)')}
        </label>
        <textarea
          id={id}
          disabled={!!registered}
          data-lm-suppress-shortcuts="true"
          rows={8}
          name="correxit-assignment-roster"
          value={value}
          onChange={({ target: { value } }) => setValue(value)}
        />
      </div>
    </div>
  );
};

const Propagate: React.FC<{
  commands: CommandRegistry;
  revised: number;
  trans: TranslationBundle;
}> = ({ commands, revised, trans }) => {
  type Message = [string, Correxit.Emitter.Emission];
  const { propagate } = Correxit.CommandIDs;
  const [command, setCommand] = useState('');
  const [timestamp, setTimestamp] = useState(revised);
  const [log, done] = useCommand<Message>(commands, command, { timestamp });
  const messages = log
    .filter(([, { type }]) => type !== 'progress')
    .map(([message]) => message);
  const [value, max]: [number, number] = log.reduce(
    (progress, [, { type, slots }]) =>
      type === 'progress' ? (slots as [number, number]) : progress,
    [0, 1]
  );
  const progress = trans.__('%1 of %2', value, max);
  return (
    <div className="correxit-assignment-propagate">
      <Log {...{ done, messages }} />
      <ToolbarButtonComponent
        {...{
          enabled: done && commands.isEnabled(propagate),
          icon: Correxit.Icons.assignment,
          label: commands.label(propagate),
          onClick: () => {
            setCommand(propagate);
            setTimestamp(Date.now());
          }
        }}
        noFocusOnClick
      />
      {!done && <progress {...{ max, value }}>{progress}</progress>}
    </div>
  );
};

const Log: React.FC<{ done: boolean; messages: string[] }> = props => {
  const { done, messages } = props;
  if (done && !messages.length) return <></>;
  const ref = useRef<HTMLPreElement | null>(null);
  const scroll = () =>
    void (ref.current && (ref.current.scrollTop = ref.current.scrollHeight));
  useEffect(scroll, [messages.length]);
  return (
    <pre ref={ref}>
      {messages.map((message, key) => (
        <Message {...{ key, message }} />
      ))}
    </pre>
  );
};

const Message: React.FC<{ message: string }> = React.memo(({ message }) => (
  <span title={message}>
    {message}
    <br />
  </span>
));
