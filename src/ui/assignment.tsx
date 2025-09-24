import { IRenderMime } from '@jupyterlab/rendermime';
import {
  Button,
  LabIcon,
  ToolbarButtonComponent
} from '@jupyterlab/ui-components';
import { find } from '@lumino/algorithm';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useRef, useState } from 'react';
import { Correxit, Rubric } from '..';
import { useCommand } from '../correxit/use-command';

type Assignment = Rubric.Assignment;

type TranslationBundle = IRenderMime.TranslationBundle;

export const Assignment: React.FC<{
  accessed: number;
  assignment: Assignment | null;
  commands: CommandRegistry;
  locked: boolean;
  trans: TranslationBundle;
}> = props => {
  if (!props.assignment) {
    return <></>;
  }

  const { accessed, commands, locked, trans } = props;
  const [assignment, setAssignment] = useState<Assignment>(props.assignment);
  const [view, setView] = useState<'assignee' | 'roster'>('assignee');
  const toggle = (to: 'assignee' | 'roster', updated: Assignment) => {
    setAssignment(updated);
    setView(to || view);
  };
  useEffect(() => {
    if (!locked) {
      commands.execute(Correxit.CommandIDs.assign, assignment).catch(_ => {});
    }
  }, [assignment]);
  return (
    <div className="correxit-assignment">
      {view === 'assignee' ? (
        <Assignee {...{ assignment, locked, toggle, trans }} />
      ) : (
        <Roster {...{ assignment, locked, toggle, trans }} />
      )}
      {!locked && <Propagate {...{ accessed, commands, trans }} />}
    </div>
  );
};

const Assignee: React.FC<{
  assignment: Assignment;
  locked: boolean;
  toggle: (to: 'assignee' | 'roster', assignment: Assignment) => void;
  trans: TranslationBundle;
}> = ({ assignment, locked, toggle, trans }) => {
  const unassigned = trans.__('Template – unassigned');
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
              ? trans.__('Template – unassigned (roster: %1)', roster.length)
              : trans.__('Template – unassigned (roster: empty)')}
          </option>
          {roster.map((value, key) => (
            <option {...{ key, value }}>{value}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

const Roster: React.FC<{
  assignment: Assignment;
  locked: boolean;
  toggle: (to: 'assignee' | 'roster', assignment: Assignment) => void;
  trans: TranslationBundle;
}> = ({ locked, toggle, trans, ...props }) => {
  const [assignment, setAssignment] = useState<Assignment>(props.assignment);
  const [value, setValue] = useState<string>(assignment.roster.join('\n'));
  const roster = value.split('\n').filter(value => !!value);
  useEffect(
    () =>
      setAssignment(({ assignee, signature }) => {
        assignee = find(roster, record => record === assignee) ? assignee : '';
        return { assignee, roster, signature };
      }),
    [roster]
  );
  if (locked) {
    return <></>;
  }

  const ref = useRef(`correxit-assignee-select-${Date.now()}`);
  return (
    <div className="correxit-assignment-roster">
      <Toggle
        {...{
          icon: Correxit.Icons.assignee,
          title: trans.__('Assignee view'),
          toggle: () => toggle('assignee', assignment)
        }}
      />
      <div>
        <label htmlFor={ref.current}>
          {trans.__('Assignment roster (line-separated)')}
        </label>
        <textarea
          id={ref.current}
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
  accessed: number;
  commands: CommandRegistry;
  trans: TranslationBundle;
}> = ({ accessed, commands, trans }) => {
  type Message = [string, Correxit.Emitter.Emission];
  const { propagate } = Correxit.CommandIDs;
  const [command, setCommand] = useState('');
  const [timestamp, setTimestamp] = useState(accessed);
  const [log, done] = useCommand<Message>(commands, command, { timestamp });
  const messages = log
    .filter(([_, { type }]) => type !== 'progress')
    .map(([message]) => message);
  const [value, max]: [number, number] = log.reduce(
    (progress, [_, { type, slots }]) =>
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
  if (done && !messages.length) {
    return <></>;
  }
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

const Toggle: React.FC<{
  disabled?: boolean;
  icon: LabIcon;
  title: string;
  toggle?: () => void;
}> = ({ disabled, icon, title, toggle }) => (
  <Button
    className="jp-mod-minimal correxit-assignment-toggle"
    disabled={disabled || false}
    onClick={toggle ? event => (event.preventDefault(), toggle()) : void 0}
    title={title}
  >
    <icon.react title={title} tag="span" />
  </Button>
);
