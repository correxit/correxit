import { IRenderMime } from '@jupyterlab/rendermime';
import { checkIcon, ToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useRef, useState } from 'react';
import { Correxit, Rubric } from '..';
import { useCommand } from '../correxit/use-command';
import { Toggle } from './toggle';

type Assignment = Rubric.Assignment;
type Registration = Rubric.Assignment.Registration;
type TranslationBundle = IRenderMime.TranslationBundle;

const { assign, enroll } = Correxit.CommandIDs;
const { Equal } = Rubric.Assignment;
const enrolled = new Map<string, Registration[] | null>();
const identify = ({ id, name }: Registration) => id || name;
const blank = (assignment: Assignment): Assignment => ({
  ...assignment,
  assignee: '',
  expiration: null,
  id: null,
  name: '',
  roster: []
});
const freeze = (assignment: Assignment, active: Registration): Assignment => ({
  ...assignment,
  ...active,
  assignee: active.roster.includes(assignment.assignee)
    ? assignment.assignee
    : ''
});

export const Assignment: React.FC<{
  commands: CommandRegistry;
  rubric: Rubric;
  trans: TranslationBundle;
}> = ({ commands, rubric, trans }) => {
  const { locked, revised } = rubric;
  const [assignment, setAssignment] = useState<Assignment>(rubric.assignment);
  const [registered, setRegistered] = useState<Registration[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'assignee' | 'roster'>('assignee');
  const keep = (next: Assignment) =>
    setAssignment(current =>
      Equal.assignment(current, next) ? current : next
    );
  const merge = (mutate: (assignment: Assignment) => Assignment) =>
    setAssignment(current => {
      const next = mutate(current);
      return Equal.assignment(current, next) ? current : next;
    });
  const pick = (next: string | null) =>
    setSelected(current => (current === next ? current : next));
  const store = (next: Registration[] | null) =>
    setRegistered(current =>
      Equal.registered(current, next) ? current : next
    );
  const toggle = (to: 'assignee' | 'roster', updated: Assignment) => {
    setAssignment(updated);
    setView(to);
  };
  const reassign = (assignment: Assignment, locked: boolean) => {
    if (!locked && !Equal.assignment(rubric.assignment, assignment))
      void commands.execute(assign, assignment).catch(_ => {});
  };
  const request = async () => {
    const cached = `${rubric.id}:${rubric.locked}`;
    if (enrolled.has(cached)) {
      store(enrolled.get(cached)!);
      return;
    }
    const result = await commands.execute(enroll).catch(_ => null);
    enrolled.set(cached, result as Registration[] | null);
    store(result as Registration[] | null);
  };

  useEffect(() => void request(), [rubric.id, rubric.locked]);
  useEffect(() => keep(rubric.assignment), [rubric.assignment]);
  useEffect(() => {
    if (registered === null) {
      pick(null);
      return;
    }
    setView('assignee');

    if (!registered.length) {
      pick(null);
      merge(blank);
      return;
    }

    const active =
      registered.find(registration => identify(registration) === selected) ||
      registered[0];
    pick(identify(active));
    merge(current => freeze(current, active));
  }, [registered, selected]);
  useEffect(() => void reassign(assignment, locked), [assignment, locked]);

  const manual = registered === null;
  const multiple = !!registered && registered.length > 1;
  return (
    <div className="correxit-assignment">
      {manual ? (
        view === 'assignee' ? (
          <Assignee {...{ assignment, locked, toggle, trans }} />
        ) : (
          <Roster {...{ assignment, locked, toggle, trans }} />
        )
      ) : (
        <Enrollment
          {...{
            assignment,
            locked,
            multiple,
            registered,
            selected,
            setSelected,
            trans
          }}
        />
      )}
      {manual && <Expiration {...{ assignment, locked, toggle, trans }} />}
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
  toggle: (to: 'assignee' | 'roster', assignment: Assignment) => void;
  trans: TranslationBundle;
}> = ({ assignment: seed, locked, toggle, trans }) => {
  const id = 'correxit-assignment-roster';
  const [assignment, setAssignment] = useState<Assignment>(seed);
  const [value, setValue] = useState<string>(assignment.roster.join('\n'));
  const roster = value.split('\n').filter(Boolean);
  useEffect(
    () =>
      setAssignment(({ assignee, ...assignment }) => ({
        ...assignment,
        assignee: roster.includes(assignee) ? assignee : '',
        roster
      })),
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

const Enrollment: React.FC<{
  assignment: Assignment;
  locked: boolean;
  multiple: boolean;
  registered: Registration[];
  selected: string | null;
  setSelected: (id: string) => void;
  trans: TranslationBundle;
}> = props => {
  const {
    assignment: { assignee, expiration, name, roster },
    locked,
    multiple,
    registered,
    selected,
    setSelected,
    trans
  } = props;
  if (!registered.length) {
    return (
      <div
        className="correxit-assignment-chip"
        title={trans.__('No registrations')}
      >
        {trans.__('No registrations')}
      </div>
    );
  }

  const due = expiration
    ? new Date(expiration).toLocaleString()
    : trans.__('No deadline');
  const line = trans.__('%1: %2 (roster: %3)', name, due, roster.length);
  const unassigned = trans.__('Template - unassigned');
  return (
    <>
      {multiple && !locked && (
        <div className="correxit-assignment-assignee">
          <div>
            <label htmlFor="correxit-assignment-registration">
              {trans.__('Assignment')}
            </label>
            <select
              id="correxit-assignment-registration"
              name="correxit-assignment-registration"
              onChange={({ target: { value } }) => setSelected(value)}
              value={selected || ''}
            >
              {registered.map(registration => (
                <option
                  key={identify(registration)}
                  value={identify(registration)}
                >
                  {registration.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="correxit-assignment-chip" title={line}>
        {line}
      </div>
      <div className="correxit-assignment-assignee">
        <div className="correxit-monospace">{assignee || unassigned}</div>
      </div>
    </>
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
