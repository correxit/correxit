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
import { useCommand } from '../correxit/commands';

type Assignment = Rubric.Assignment;

type TranslationBundle = IRenderMime.TranslationBundle;

export const Assignment: React.FC<{
  assignment: Assignment | null;
  commands: CommandRegistry;
  keys: Pick<Rubric, 'accessed' | 'locked'> | null;
  trans: TranslationBundle;
}> = props => {
  if (!props.assignment || !props.keys) {
    return <></>;
  }

  const { commands, keys, trans } = props;
  const { accessed, locked } = keys;
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
    <>
      {view === 'assignee' ? (
        <Assignee key={accessed} {...{ assignment, locked, toggle, trans }} />
      ) : (
        <Roster key={accessed} {...{ assignment, locked, toggle, trans }} />
      )}
      {!locked && <Propagate {...{ accessed, commands, trans }} />}
    </>
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
        <Disabled icon={icon} title={trans.__('Roster view')} />
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
  const [log, done] = useCommand<Message>(commands, command, { accessed });
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
      {!done && <progress {...{ max, value }}>{progress}</progress>}
      {!!messages.length && <Log {...{ messages }} />}
      <ToolbarButtonComponent
        {...{
          enabled: done && commands.isEnabled(propagate),
          icon: Correxit.Icons.assignment,
          label: commands.label(propagate),
          onClick: () => setCommand(propagate)
        }}
        noFocusOnClick
      />
    </div>
  );
};

const Log: React.FC<{ messages: string[] }> = ({ messages }) => {
  const ref = useRef<HTMLPreElement | null>(null);
  const scroll = () =>
    void (ref.current && (ref.current.scrollTop = ref.current.scrollHeight));
  useEffect(scroll, [messages.length]);
  return (
    <pre ref={ref}>
      {messages.map((message, key) => (
        <Message key={key} message={message} />
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

const Disabled: React.FC<{
  title: string;
  icon: LabIcon;
}> = ({ icon, title }) => (
  <Button
    className="jp-mod-minimal correxit-assignment-toggle"
    disabled={true}
    title={title}
  >
    <icon.react title={title} tag="span" />
  </Button>
);

const Toggle: React.FC<{
  icon: LabIcon;
  title: string;
  toggle: () => void;
}> = ({ icon, title, toggle }) => (
  <Button
    className="jp-mod-minimal correxit-assignment-toggle"
    onClick={event => {
      event.preventDefault();
      toggle();
    }}
    title={title}
  >
    <icon.react title={title} tag="span" />
  </Button>
);
