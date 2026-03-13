import { IRenderMime } from '@jupyterlab/rendermime';
import { checkIcon, ToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';
import { Toggle } from './toggle';

type Assignment = Rubric.Assignment;
type Registered = Awaited<ReturnType<Correxit.Registrar>>;
type Enrolled = {
  cached: string;
  expires: number;
  registered: Registered;
};
type Registration = Rubric.Assignment.Registration;
type Course = { assignments: Registration[]; group: string };
type TranslationBundle = IRenderMime.TranslationBundle;

const throttle = 5_000;
const { assign, enroll, propagate, propagator: reveal } = Correxit.CommandIDs;
const { Equal } = Rubric.Assignment;
const enrolled = new WeakMap<Workbook, Enrolled>();
const identify = ({ id, name }: Registration) => id || name;
const blank = (assignment: Assignment): Assignment => ({
  ...assignment,
  assignee: '',
  expiration: null,
  id: null,
  name: '',
  roster: []
});
const format = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};
const freeze = (assignment: Assignment, active: Registration): Assignment => ({
  ...assignment,
  ...active,
  assignee: active.roster.includes(assignment.assignee)
    ? assignment.assignee
    : ''
});
const courses = (registered: Registered): Course[] | null =>
  registered === null
    ? null
    : registered.length && 'group' in registered[0]
      ? (registered as Course[])
      : [{ assignments: registered as Registration[], group: '' }];
const flat = (course: Course[]): Registration[] =>
  course.flatMap(({ assignments }) => assignments);
const option = (registration: Registration) => (
  <option key={identify(registration)} value={identify(registration)}>
    {registration.name}
  </option>
);

export const Assignment: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, trans, workbook }) => {
  const rubric = Workbook.open(workbook, true)!;
  const { locked } = rubric;
  const [assignment, setAssignment] = useState<Assignment>(rubric.assignment);
  const [registered, setRegistered] = useState<Registered>(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'assignee' | 'roster'>('assignee');
  const cached = rubric.id;
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
  const store = (next: Registered) =>
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
    const now = Date.now();
    const current = enrolled.get(workbook);
    if (current?.cached === cached) store(current.registered);
    setPending(!current);
    if (current?.cached === cached && now < current.expires) return;
    try {
      const result = await commands.execute(enroll).catch(_ => null);
      const registered = result as Registered;
      enrolled.set(workbook, { cached, expires: now + throttle, registered });
      store(registered);
    } finally {
      setPending(false);
    }
  };
  useEffect(() => void request(), [cached, workbook]);
  useEffect(() => keep(rubric.assignment), [rubric.assignment]);
  useEffect(() => {
    if (locked) return;
    const resolved = courses(registered);
    const roster = resolved ? flat(resolved) : null;
    if (roster === null) {
      pick(null);
      return;
    }
    setView('assignee');
    if (!roster.length) {
      pick(null);
      merge(blank);
      return;
    }

    const matched = selected
      ? roster.find(r => identify(r) === selected)
      : selected === ''
        ? null
        : roster.find(record => identify(record) === rubric.assignment.id) ||
          (roster.length === 1 ? roster[0] : null);
    if (!matched) {
      if (selected !== '') pick(null);
      merge(blank);
      return;
    }
    pick(identify(matched));
    merge(current => freeze(current, matched));
  }, [locked, registered, selected]);
  useEffect(() => void reassign(assignment, locked), [assignment, locked]);

  const all =
    courses(registered) ??
    (locked ? [{ assignments: [rubric.assignment], group: '' }] : null);
  const roster = all ? flat(all) : null;
  const manual = roster === null;
  const multiple = !!roster && roster.length > 1;
  if (pending) return <div className="correxit-assignment cxt-mod-pending" />;
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
            all: all!,
            assignment,
            locked,
            multiple,
            registered: roster,
            selected,
            setSelected,
            trans
          }}
        />
      )}
      {manual && <Expiration {...{ assignment, locked, toggle, trans }} />}
      {!locked && (
        <div className="correxit-assignment-propagate">
          <ToolbarButtonComponent
            {...{
              enabled: commands.isEnabled(propagate),
              icon: Correxit.Icons.assignment,
              label: commands.label(propagate),
              onClick: () => void commands.execute(reveal)
            }}
            noFocusOnClick
          />
        </div>
      )}
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
    const label = Rubric.date(expiration, trans.__('No deadline'));
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
    [value]
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
  all: Course[];
  assignment: Assignment;
  locked: boolean;
  multiple: boolean;
  registered: Registration[];
  selected: string | null;
  setSelected: (id: string) => void;
  trans: TranslationBundle;
}> = props => {
  const {
    all,
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

  const due = Rubric.date(expiration, trans.__('No deadline'));
  const lookup = locked ? props.assignment.id : selected;
  const active = all.find(course =>
    course.assignments.some(record => identify(record) === lookup)
  );
  const { group } = active || {};
  const line = locked
    ? group
      ? trans.__('%1: %2 (%3)', group, name, due)
      : trans.__('%1 (%2)', name, due)
    : active?.group
      ? trans.__('%1: %2 (%3) roster: %4', group, name, due, roster.length)
      : trans.__('%1 (%2) roster: %3', name, due, roster.length);
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
              value={selected ?? ''}
            >
              <option value="">{trans.__('No assignment')}</option>
              {all.some(c => c.group)
                ? all.map(c => (
                    <optgroup key={c.group} label={c.group}>
                      {c.assignments.map(option)}
                    </optgroup>
                  ))
                : registered.map(option)}
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
