import { IRenderMime } from '@jupyterlab/rendermime';
import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
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
const blank: Partial<Draft.Fields> = {
  assignee: '',
  expiration: null,
  id: null,
  name: '',
  overdue: null,
  penalty: null,
  roster: ''
};
const freeze = ({
  expiration,
  id,
  name,
  roster
}: Registration): Partial<Draft.Fields> => ({
  expiration,
  id,
  name,
  roster: roster.join('\n'),
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
const same = (x: unknown, y: unknown) =>
  JSON.stringify(x) === JSON.stringify(y);

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
  const groups = [
    ['assignee'],
    ['expiration'],
    ['id'],
    ['name'],
    ['overdue', 'penalty'],
    ['roster']
  ] as const;
  const keys = groups.flat();
  type Changes = Partial<Pick<Assignment, (typeof keys)[number]>>;
  export type Fields = Omit<Required<Changes>, 'roster'> & { roster: string };
  type Save = Readonly<{ version: number; changes: Changes }>;
  export type State = Readonly<{
    assignment: Assignment;
    fields: Fields;
    queued: readonly (keyof Fields)[];
    version: number;
  }> &
    (
      | { phase: 'ready' | 'failed'; save: null }
      | { phase: 'saving'; save: Save }
    );
  type Editor = {
    id: string;
    dispose: () => void;
    read: () => State;
    subscribe: (listener: () => void) => () => void;
    edit: (update: Partial<Fields>) => void;
    observe: (assignment: Assignment, locked: boolean) => void;
  };
  const drafts = new WeakMap<Workbook, Editor>();
  const fields = (assignment: Assignment): Fields =>
    ({
      ...Object.fromEntries(keys.map(key => [key, assignment[key]])),
      roster: assignment.roster.join('\n')
    }) as Fields;
  // Keep observed normalization out of the input history.
  const values = (state: State): Assignment => ({
    ...state.assignment,
    ...state.fields,
    roster: split(state.fields.roster)
  });

  export function open(
    workbook: Workbook,
    rubric: Rubric,
    commands: CommandRegistry
  ): Editor {
    const cached = drafts.get(workbook);
    if (cached?.id === rubric.id) return cached;
    cached?.dispose();

    const { id } = rubric;
    let locked = rubric.locked;
    let state = create(rubric.assignment);
    let delay: number | null = null;
    const listeners = new Set<() => void>();
    const current = () => {
      if (workbook.context.isDisposed || drafts.get(workbook) !== editor)
        return null;
      const rubric = Workbook.open(workbook, true);
      return rubric?.id === id && !rubric.locked ? rubric : null;
    };
    const update = (next: State) => {
      if (state === next) return;
      state = next;
      if (delay !== null) window.clearTimeout(delay);
      delay = null;
      if (
        current() &&
        state.phase === 'ready' &&
        (state.queued.length || Object.keys(changes(state)).length)
      )
        delay = window.setTimeout(() => void persist(), DELAY);
      listeners.forEach(listener => listener());
    };
    const persist = async () => {
      const rubric = current();
      if (!rubric) return;
      const next = observe(state, rubric.assignment);
      const input = view(next);
      const patch = {
        ...changes(next, input),
        ...Object.fromEntries(next.queued.map(key => [key, input[key]]))
      };
      if (next.phase !== 'ready' || !Object.keys(patch).length)
        return update(next);

      const save = { version: next.version, changes: patch };
      // Snapshot the normalized value being saved so an explicit reversion survives.
      update({
        ...next,
        fields: { ...next.fields, assignee: input.assignee },
        queued: [],
        phase: 'saving',
        save
      });

      const assignment = await commands
        .execute(assign, {
          ...patch,
          path: workbook.context.path,
          view: workbook.content?.id ?? null,
          rubric: id
        })
        .catch(() => null);
      if (state.save !== save) return;
      const latest = current();
      // Only edits beyond the completed patch remain queued, including reversions.
      const saved: State = assignment
        ? {
            ...state,
            assignment: { ...state.assignment, ...save.changes },
            phase: 'ready',
            save: null
          }
        : state;
      const observed = latest ? observe(saved, latest.assignment) : saved;
      // Retry a failure only for new input or a changed normalized patch.
      update({
        ...observed,
        phase:
          (assignment && latest) ||
          observed.version !== save.version ||
          !same(changes(observed), patch)
            ? 'ready'
            : 'failed',
        save: null
      });
    };
    const notebook = workbook.context.model.sharedModel;
    const refresh = () => {
      const rubric = Workbook.open(workbook, true);
      if (!rubric || rubric.id !== id) return editor.dispose();
      editor.observe(rubric.assignment, rubric.locked);
    };
    const editor: Editor = {
      id,
      dispose: () => {
        if (delay !== null) window.clearTimeout(delay);
        notebook.metadataChanged.disconnect(refresh);
        workbook.context.disposed.disconnect(editor.dispose);
        workbook.content?.disposed.disconnect(editor.dispose);
        drafts.delete(workbook);
      },
      read: () => state,
      subscribe: listener => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      edit: fields => update(edit(state, fields)),
      observe: (assignment, next) => {
        const reset = locked || next;
        locked = next;
        update(reset ? create(assignment) : observe(state, assignment));
      }
    };
    drafts.set(workbook, editor);
    // Cached drafts must observe lock transitions even while their view is inactive.
    notebook.metadataChanged.connect(refresh);
    workbook.context.disposed.connect(editor.dispose);
    workbook.content?.disposed.connect(editor.dispose);
    return editor;
  }

  export function create(assignment: Assignment): State {
    return {
      assignment,
      fields: fields(assignment),
      queued: [],
      version: 0,
      phase: 'ready',
      save: null
    };
  }

  export function view(state: State): Assignment {
    const assignment = values(state);
    return {
      ...assignment,
      assignee: assignment.roster.includes(assignment.assignee)
        ? assignment.assignee
        : ''
    };
  }

  export function edit(state: State, update: Partial<Fields>): State {
    const fields = { ...state.fields, ...update };
    if (same(fields, state.fields)) return state;

    const current = values(state);
    const next = values({ ...state, fields });
    const changed = Object.keys(
      changes({ ...state, assignment: current }, next)
    ) as (keyof Fields)[];
    // Formatting changes only the displayed text, not the input history.
    if (!changed.length) return { ...state, fields };

    const version = state.version + 1;
    // Keep explicit intent until it is included in a save, even at the baseline.
    const queued = Array.from(new Set([...state.queued, ...changed]));
    return state.phase === 'failed'
      ? { ...state, fields, queued, version, phase: 'ready', save: null }
      : { ...state, fields, queued, version };
  }

  export function changes(state: State, assignment = view(state)): Changes {
    const patch = Object.fromEntries(
      groups
        .filter(keys =>
          keys.some(key => !same(assignment[key], state.assignment[key]))
        )
        .flatMap(keys => keys.map(key => [key, assignment[key]]))
    );
    // Clearing a deadline also clears its policy, even if it was already null.
    return assignment.expiration === null &&
      state.assignment.expiration !== null
      ? { ...patch, overdue: null, penalty: null }
      : patch;
  }

  export function observe(state: State, assignment: Assignment): State {
    if (assignment === state.assignment) return state;

    const next = fields(assignment);
    const current = values(state);
    const edited = { ...state.save?.changes, ...changes(state, current) };

    // Keep edited fields, including a reversion made while save is pending.
    const merged = Object.fromEntries(
      keys.map(key => [
        key,
        state.queued.includes(key) ||
        key in edited ||
        same(current[key], assignment[key])
          ? state.fields[key]
          : next[key]
      ])
    ) as Fields;

    return { ...state, assignment, fields: merged };
  }
}

export const Assignment: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook;
}> = ({ commands, trans, workbook }) => {
  const rubric = Workbook.open(workbook, true)!;
  return (
    <Editor
      key={`${workbook.context.path}:${rubric.id}`}
      {...{ commands, trans, workbook, rubric }}
    />
  );
};

const Editor: React.FC<{
  commands: CommandRegistry;
  trans: TranslationBundle;
  workbook: Workbook;
  rubric: Rubric;
}> = ({ commands, trans, workbook, rubric }) => {
  const { locked } = rubric;
  const draft = Draft.open(workbook, rubric, commands);
  const state = useSyncExternalStore(draft.subscribe, draft.read);
  const [registered, setRegistered] = useState<Registered>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const assignment = locked ? rubric.assignment : Draft.view(state);
  const cached = rubric.id;
  const { edit } = draft;
  const pick = (next: string | null) =>
    setSelected(current => (current === next ? current : next));
  useEffect(() => {
    const store = (next: Registered) =>
      setRegistered(current =>
        Equal.registered(current, next) ? current : next
      );
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
    void request();
  }, [cached, commands, workbook]);
  useEffect(() => {
    draft.observe(rubric.assignment, locked);
  }, [draft, locked, rubric.assignment]);
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
      edit(blank);
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
      edit(blank);
      return;
    }
    pick(identify(matched));
    edit(freeze(matched));
  }, [edit, locked, registered, rubric.assignment.id, selected]);

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
            <Roster
              {...{ assignment, edit, locked, trans }}
              value={state.fields.roster}
            />
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
  edit: (update: Partial<Draft.Fields>) => void;
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
          onChange={({ target: { value } }) => edit({ assignee: value })}
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
  edit: (update: Partial<Draft.Fields>) => void;
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
  edit: (update: Partial<Draft.Fields>) => void;
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
    edit({ overdue: 'dock', penalty });
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
  edit: (update: Partial<Draft.Fields>) => void;
  locked: boolean;
  trans: TranslationBundle;
  value: string;
}> = ({ assignment, edit, locked, trans, value }) => {
  const id = 'correxit-assignment-roster';
  const hint = `${id}-hint`;
  const seed = assignment.roster.join('\n');

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
          onBlur={() => edit({ roster: seed })}
          onChange={({ target: { value } }) => edit({ roster: value })}
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
