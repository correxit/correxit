import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState } from 'react';
import { Correxit, Rubric, Workbook } from '..';

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

const DELAY = 150;
const TTL = 10_000;
const { assign, enroll, resource, track } = Correxit.CommandIDs;
const { Equal } = Rubric.Assignment;
const enrolled = new WeakMap<Workbook, Enrolled>();
const identify = ({ id, name }: Registration) => id || name;
const blank = (assignment: Assignment): Assignment => ({
  ...assignment,
  assignee: '',
  expiration: null,
  id: null,
  name: '',
  overdue: null,
  penalty: null,
  roster: []
});
const equal = Equal.assignment;
const freeze = (assignment: Assignment, active: Registration): Assignment => ({
  ...assignment,
  ...active,
  assignee: active.roster.includes(assignment.assignee)
    ? assignment.assignee
    : '',
  overdue: null,
  penalty: null
});
const courses = (registered: Registered): Course[] | null =>
  registered === null
    ? null
    : registered.length && 'group' in registered[0]
      ? (registered as Course[])
      : [{ assignments: registered as Registration[], group: '' }];
const flat = (course: Course[]): Registration[] =>
  course.flatMap(({ assignments }) => assignments);
const split = (value: string) =>
  Array.from(
    new Set(
      value
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    )
  );
const same = (x: string[], y: string[]) =>
  x.length === y.length && x.every((record, i) => record === y[i]);

const count = ({ roster }: Assignment, trans: TranslationBundle) =>
  trans.__('%1 entries', roster.length);

const due = ({ expiration }: Assignment, trans: TranslationBundle) =>
  Rubric.timestamp(expiration, trans.__('No deadline'));

const policy = ({ overdue, penalty }: Assignment, trans: TranslationBundle) => {
  if (overdue === 'dock') return trans.__('Dock %1%', penalty ?? 0);
  if (overdue === 'reject') return trans.__('Reject submission');
  return trans.__('Accept late');
};

const headline = (
  { name }: Assignment,
  manual: boolean,
  trans: TranslationBundle
) => {
  if (name) return name;
  return manual ? trans.__('Manual roster') : trans.__('No assignment');
};

const option = (registration: Registration) => (
  <option key={identify(registration)} value={identify(registration)}>
    {registration.name}
  </option>
);

namespace Draft {
  export type State = Readonly<{
    assignment: Assignment;
    local: boolean;
  }>;

  export function create(assignment: Assignment): State {
    return { assignment, local: false };
  }

  export function edit(state: State, assignment: Assignment): State {
    return equal(state.assignment, assignment)
      ? state
      : { assignment, local: true };
  }

  export function merge(
    state: State,
    mutate: (assignment: Assignment) => Assignment
  ): State {
    return edit(state, mutate(state.assignment));
  }

  export function persist(
    state: State,
    assignment: Assignment,
    locked: boolean
  ): boolean {
    return state.local && !locked && !equal(state.assignment, assignment);
  }

  export function sync(state: State, assignment: Assignment): State {
    return equal(state.assignment, assignment)
      ? state.local
        ? { ...state, local: false }
        : state
      : { assignment, local: false };
  }
}

export const Assignment: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, trans, workbook }) => {
  const rubric = Workbook.open(workbook, true)!;
  const { locked } = rubric;
  const [state, setState] = useState(() => Draft.create(rubric.assignment));
  const [registered, setRegistered] = useState<Registered>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { assignment, local } = state;
  const cached = rubric.id;
  const keep = (next: Assignment) =>
    setState(current => Draft.sync(current, next));
  const edit = (assignment: Assignment) =>
    setState(current => Draft.edit(current, assignment));
  const merge = (mutate: (assignment: Assignment) => Assignment) =>
    setState(current => Draft.merge(current, mutate));
  const pick = (next: string | null) =>
    setSelected(current => (current === next ? current : next));
  const store = (next: Registered) =>
    setRegistered(current =>
      Equal.registered(current, next) ? current : next
    );
  const reassign = (assignment: Assignment, locked: boolean) => {
    if (!locked && !equal(rubric.assignment, assignment))
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
      enrolled.set(workbook, { cached, expires: now + TTL, registered });
      store(registered);
    } finally {
      setPending(false);
    }
  };
  // Enrollment is refreshed only when the workbook or rubric identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [locked, registered, rubric.assignment.id, selected]);
  // The listed values are semantic inputs; `reassign` is a render-local verb.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    const dirty = Draft.persist(
      { assignment, local },
      rubric.assignment,
      locked
    );
    if (!dirty) return;

    const delay = window.setTimeout(() => reassign(assignment, locked), DELAY);
    return () => window.clearTimeout(delay);
  }, [assignment, local, locked, rubric.assignment]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const all =
    courses(registered) ??
    (locked ? [{ assignments: [rubric.assignment], group: '' }] : null);
  const roster = all ? flat(all) : null;
  const manual = roster === null;
  const multiple = !!roster && roster.length > 1;
  if (pending) return <div className="correxit-assignment cxt-mod-pending" />;
  return (
    <div className="correxit-assignment">
      <Facts {...{ assignment, manual, trans }} />
      <div className="correxit-assignment-controls">
        {manual ? (
          <>
            <Roster {...{ assignment, edit, locked, trans }} />
            <Assignee {...{ assignment, edit, locked, trans }} />
          </>
        ) : (
          <Enrollment
            {...{
              all: all!,
              assignment,
              commands,
              locked,
              multiple,
              registered: roster,
              selected,
              setSelected,
              trans
            }}
          />
        )}
        {manual && <Expiration {...{ assignment, edit, locked, trans }} />}
        {manual && <Overdue {...{ assignment, edit, locked, trans }} />}
        <Resources {...{ assignment, commands, locked, trans }} />
      </div>
      {!locked && (
        <div className="correxit-assignment-propagate">
          <label className="correxit-assignment-overwrite">
            <input
              checked={overwrite}
              onChange={({ target }) => setOverwrite(target.checked)}
              type="checkbox"
            />
            {trans.__('Replace existing')}
          </label>
          <CommandToolbarButtonComponent
            args={{ overwrite }}
            commands={commands}
            id={track}
          />
        </div>
      )}
    </div>
  );
};

const Facts: React.FC<{
  assignment: Assignment;
  manual: boolean;
  trans: TranslationBundle;
}> = ({ assignment, manual, trans }) => {
  const facts = [
    {
      label: trans.__('Assignment'),
      value: headline(assignment, manual, trans)
    },
    {
      label: trans.__('Assignee'),
      value: assignment.assignee || trans.__('Template')
    },
    {
      label: trans.__('Roster'),
      value: count(assignment, trans)
    },
    {
      label: trans.__('Deadline'),
      value: due(assignment, trans)
    }
  ];
  if (manual && assignment.expiration !== null) {
    facts.push({
      label: trans.__('Overdue'),
      value: policy(assignment, trans)
    });
  }
  return (
    <div className="correxit-assignment-facts">
      {facts.map(({ label, value }) => (
        <div className="correxit-assignment-fact" key={label}>
          <span className="correxit-assignment-fact-label">{label}</span>
          <span className="correxit-assignment-fact-value" title={value}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
};

const Assignee: React.FC<{
  assignment: Assignment;
  edit: (assignment: Assignment) => void;
  locked: boolean;
  trans: TranslationBundle;
}> = ({ assignment, edit, locked, trans }) => {
  const id = 'correxit-assignment-assignee';
  const unassigned = trans.__('Template - unassigned');
  const { assignee, roster } = assignment;
  if (locked) {
    const assignee = assignment.assignee || unassigned;
    return (
      <div className="correxit-assignment-assignee">
        <div>
          <label>{trans.__('Assignee')}</label>
          <div className="correxit-monospace">{assignee}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="correxit-assignment-assignee">
      <div>
        <label htmlFor={id}>{trans.__('Assignee')}</label>
        {!roster.length && (
          <div className="correxit-assignment-hint">
            {trans.__('Add roster entries first.')}
          </div>
        )}
        <select
          disabled={!roster.length}
          id={id}
          name="correxit-assignment-assignee"
          onChange={({ target: { value } }) =>
            edit({ ...assignment, assignee: value })
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
  edit: (assignment: Assignment) => void;
  locked: boolean;
  trans: TranslationBundle;
}> = ({ assignment, edit, locked, trans }) => {
  const { expiration } = assignment;
  const className =
    expiration !== null && Date.now() > expiration
      ? 'correxit-assignment-expiration cxt-mod-expired'
      : 'correxit-assignment-expiration';
  if (locked) {
    const label = Rubric.timestamp(expiration, trans.__('No deadline'));
    return (
      <div className={className}>
        <div className="correxit-monospace">{label}</div>
      </div>
    );
  }

  const format = (timestamp: number): string => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  };
  const update = (value: string) => {
    const expiration = value ? new Date(value).getTime() : null;
    edit({
      ...assignment,
      expiration,
      overdue: expiration === null ? null : assignment.overdue,
      penalty: expiration === null ? null : assignment.penalty
    });
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

const Overdue: React.FC<{
  assignment: Assignment;
  edit: (assignment: Assignment) => void;
  locked: boolean;
  trans: TranslationBundle;
}> = ({ assignment, edit, locked, trans }) => {
  const current = assignment.overdue ?? 'accept';
  const id = 'correxit-assignment-penalty';
  const hint = `${id}-hint`;
  const initial = current === 'dock' ? String(assignment.penalty ?? 10) : '';
  const [text, setText] = useState(initial);
  useEffect(() => {
    const next = current === 'dock' ? String(assignment.penalty ?? 10) : '';
    setText(current => (current === next ? current : next));
  }, [assignment.penalty, current]);
  if (assignment.expiration === null) return null;
  if (locked) {
    return (
      <div className="correxit-assignment-overdue">
        <div>
          <label>{trans.__('Overdue')}</label>
          <div className="correxit-monospace">{policy(assignment, trans)}</div>
        </div>
      </div>
    );
  }

  const update = (overdue: Exclude<Assignment['overdue'], null>) => {
    edit({
      ...assignment,
      overdue,
      penalty: overdue === 'dock' ? (assignment.penalty ?? 10) : null
    });
  };
  const penalty = (value: string) => {
    setText(value);
    if (!value.trim()) return;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return;
    const penalty = Math.max(0, Math.min(100, parsed));
    edit({ ...assignment, overdue: 'dock', penalty });
  };
  const reset = () => setText(String(assignment.penalty ?? 10));
  return (
    <div className="correxit-assignment-overdue">
      <div>
        <label htmlFor="correxit-assignment-overdue">
          {trans.__('Overdue')}
        </label>
        <select
          id="correxit-assignment-overdue"
          name="correxit-assignment-overdue"
          onChange={({ target: { value } }) =>
            update(value as Exclude<Assignment['overdue'], null>)
          }
          value={current}
        >
          <option value="accept">{trans.__('Accept late')}</option>
          <option value="dock">{trans.__('Dock score')}</option>
          <option value="reject">{trans.__('Reject submission')}</option>
        </select>
        {current === 'dock' && (
          <>
            <label htmlFor={id}>{trans.__('Penalty')}</label>
            <div className="correxit-assignment-hint" id={hint}>
              {trans.__('Percentage of possible points to deduct.')}
            </div>
            <input
              aria-describedby={hint}
              id={id}
              max={100}
              min={0}
              name="correxit-assignment-penalty"
              onBlur={reset}
              onChange={({ target: { value } }) => penalty(value)}
              step={1}
              type="number"
              value={text}
            />
          </>
        )}
      </div>
    </div>
  );
};

const Roster: React.FC<{
  assignment: Assignment;
  edit: (assignment: Assignment) => void;
  locked: boolean;
  trans: TranslationBundle;
}> = ({ assignment, edit, locked, trans }) => {
  const id = 'correxit-assignment-roster';
  const hint = `${id}-hint`;
  const seed = assignment.roster.join('\n');
  const [value, setValue] = useState<string>(seed);
  useEffect(() => {
    if (same(split(value), assignment.roster)) return;
    setValue(seed);
  }, [assignment.roster, seed, value]);

  const update = (value: string) => {
    const roster = split(value);
    setValue(value);
    edit({
      ...assignment,
      assignee: roster.includes(assignment.assignee) ? assignment.assignee : '',
      roster
    });
  };

  if (locked) {
    const title = seed || undefined;
    return (
      <div className="correxit-assignment-roster">
        <div>
          <label>{trans.__('Roster')}</label>
          <div
            className={
              assignment.roster.length
                ? 'correxit-assignment-list'
                : 'correxit-assignment-list cxt-mod-empty'
            }
            title={title}
          >
            {seed || trans.__('No roster entries')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="correxit-assignment-roster">
      <div>
        <label htmlFor={id}>{trans.__('Roster')}</label>
        <div className="correxit-assignment-hint" id={hint}>
          {trans.__('One assignee per line.')}
        </div>
        <textarea
          aria-describedby={hint}
          id={id}
          data-lm-suppress-shortcuts="true"
          name="correxit-assignment-roster"
          onBlur={() => setValue(assignment.roster.join('\n'))}
          onChange={({ target: { value } }) => update(value)}
          rows={6}
          spellCheck={false}
          value={value}
        />
      </div>
    </div>
  );
};

const Resources: React.FC<{
  assignment: Assignment;
  commands: CommandRegistry;
  locked: boolean;
  trans: TranslationBundle;
}> = ({ assignment, commands, locked, trans }) => {
  const { resources } = assignment;
  const list = resources?.join('\n') ?? '';
  const empty = trans.__('No resource files');
  if (locked) {
    return (
      <div className="correxit-assignment-resources">
        <div>
          <label>{trans.__('Resources')}</label>
          <div
            className={
              resources
                ? 'correxit-assignment-list'
                : 'correxit-assignment-list cxt-mod-empty'
            }
            title={list || undefined}
          >
            {list || empty}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="correxit-assignment-resources">
      <div>
        <label>{trans.__('Resources')}</label>
        {resources ? (
          <div className="correxit-assignment-list" title={list}>
            {list}
          </div>
        ) : (
          <div className="correxit-assignment-list cxt-mod-empty">{empty}</div>
        )}
        <div className="correxit-assignment-resource-actions">
          <CommandToolbarButtonComponent
            commands={commands}
            id={resource}
            label={trans.__('Pick files...')}
          />
          {resources && (
            <CommandToolbarButtonComponent
              commands={commands}
              id={resource}
              args={{ resources: null }}
              label={trans.__('Clear')}
            />
          )}
        </div>
      </div>
    </div>
  );
};

const Enrollment: React.FC<{
  all: Course[];
  assignment: Assignment;
  commands: CommandRegistry;
  locked: boolean;
  multiple: boolean;
  registered: Registration[];
  selected: string | null;
  setSelected: (id: string) => void;
  trans: TranslationBundle;
}> = props => {
  const {
    all,
    assignment: { assignee },
    commands,
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
              disabled={!!assignee}
              id="correxit-assignment-registration"
              name="correxit-assignment-registration"
              onChange={({ target: { value } }) => setSelected(value)}
              value={selected ?? ''}
            >
              <option value="">{trans.__('No assignment')}</option>
              {all.some(({ group }) => group)
                ? all.map(({ assignments, group }) => (
                    <optgroup key={group} label={group}>
                      {assignments.map(option)}
                    </optgroup>
                  ))
                : registered.map(option)}
            </select>
          </div>
        </div>
      )}
      <div className="correxit-assignment-assignee">
        <div className="correxit-monospace">{assignee || unassigned}</div>
        <CommandToolbarButtonComponent
          {...{ commands, id: Correxit.CommandIDs.unassign, label: '' }}
        />
      </div>
    </>
  );
};
