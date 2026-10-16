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
