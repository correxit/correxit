import type { Rubric } from '../correxit/rubric';

type Assignment = Rubric.Assignment;

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

/** Pure assignment draft transitions; no notebook or React lifetime. */
export namespace Draft {
  type Changes = Partial<Pick<Assignment, (typeof keys)[number]>>;
  type Save = Readonly<{ version: number; changes: Changes }>;

  export type Fields = Omit<Required<Changes>, 'roster'> & { roster: string };

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

  const groups = [
    ['assignee'],
    ['expiration'],
    ['id'],
    ['name'],
    ['overdue', 'penalty'],
    ['roster']
  ] as const;
  const keys = groups.flat();
  const fields = (assignment: Assignment): Fields =>
    ({
      ...Object.fromEntries(keys.map(key => [key, assignment[key]])),
      roster: assignment.roster.join('\n')
    }) as Fields;
  const values = (state: State): Assignment => ({
    ...state.assignment,
    ...state.fields,
    roster: split(state.fields.roster)
  });

  /** Observe the workbook and snapshot the next save, if one is ready. */
  export function begin(state: State, assignment: Assignment): State {
    const next = observe(state, assignment);
    if (!pending(next)) return next;

    return {
      ...next,
      fields: { ...next.fields, assignee: view(next).assignee },
      queued: [],
      phase: 'saving',
      save: { version: next.version, changes: patch(next) }
    };
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

  /** Acknowledge only this save; later edits and replacement drafts survive. */
  export function complete(
    state: State,
    save: Save,
    accepted: boolean,
    assignment: Assignment | null
  ): State {
    if (state.save !== save) return state;

    const saved: State = accepted
      ? {
          ...state,
          assignment: { ...state.assignment, ...save.changes },
          phase: 'ready',
          save: null
        }
      : {
          ...state,
          // Failed fields remain intended; newer edits keep their current values.
          queued: Array.from(
            new Set([
              ...state.queued,
              ...(Object.keys(save.changes) as (keyof Fields)[])
            ])
          )
        };
    const observed = assignment ? observe(saved, assignment) : saved;
    // Observations and formatting alone must not retry an unchanged failure.
    const ready =
      (accepted && assignment !== null) ||
      observed.version !== save.version ||
      !same(patch(observed), save.changes);
    return { ...observed, phase: ready ? 'ready' : 'failed', save: null };
  }

  /** Include explicit intent even when the optimistic baseline already matches. */
  export function patch(state: State): Changes {
    const input = view(state);
    const difference = changes(state, input);
    return Object.fromEntries(
      keys
        .filter(key => key in difference || state.queued.includes(key))
        .map(key => [
          key,
          state.queued.includes(key) ? input[key] : difference[key]
        ])
    );
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

  /** An explicit selection retains every supplied field, even unchanged ones. */
  export function select(state: State, update: Partial<Fields>): State {
    const next = retry(edit(state, update));
    return {
      ...next,
      version: state.version + 1,
      queued: Array.from(
        new Set([...next.queued, ...(Object.keys(update) as (keyof Fields)[])])
      )
    };
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

  /** Whether the current draft can schedule a save. */
  export function pending(state: State): boolean {
    return state.phase === 'ready' && Object.keys(patch(state)).length > 0;
  }

  /** Explicitly retry retained input without inventing another edit. */
  export function retry(state: State): State {
    return state.phase === 'failed' ? { ...state, phase: 'ready' } : state;
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
}
