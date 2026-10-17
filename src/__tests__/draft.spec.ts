import type { Rubric } from '../correxit/rubric';
import { Draft } from '../ui/draft';

const example = require('./fixtures/cxtformat-2-metadata.json');

const assignment: Rubric.Assignment = {
  ...(example.assignment as Rubric.Assignment),
  assignee: 'alice',
  roster: ['alice', 'bob'],
  overdue: null,
  penalty: null
};

describe('Assignment drafts', () => {
  it('preserves raw roster formatting without recording another edit', () => {
    const state = Draft.edit(Draft.create(assignment), {
      roster: ' alice \n bob\nalice\n'
    });
    expect(state.fields.roster).toBe(' alice \n bob\nalice\n');
    expect(Draft.view(state).roster).toEqual(['alice', 'bob']);
    expect(state.version).toBe(0);
    expect(state.queued).toEqual([]);
    expect(Draft.changes(state)).toEqual({});
  });

  it('retains a queued reversion when the observed baseline moves', () => {
    const edited = Draft.edit(Draft.create(assignment), { assignee: 'bob' });
    const reverted = Draft.edit(edited, { assignee: 'alice' });
    expect(Draft.changes(reverted)).toEqual({});
    expect(Draft.patch(reverted)).toEqual({ assignee: 'alice' });
    const observed = Draft.observe(reverted, {
      ...assignment,
      assignee: 'bob'
    });
    expect(Draft.view(observed).assignee).toBe('alice');
    expect(observed.queued).toContain('assignee');
    expect(Draft.changes(observed)).toEqual({ assignee: 'alice' });
  });

  it.each(['edit', 'select'] as const)(
    '%s distinguishes registrar initialization from a complete selection',
    method => {
      const original = {
        ...assignment,
        assignee: '',
        id: 'A',
        name: 'Assignment A'
      };
      const selected = {
        id: 'B',
        name: 'Assignment B',
        roster: original.roster.join('\n'),
        expiration: original.expiration,
        overdue: null,
        penalty: null
      };
      const edited = Draft[method](Draft.create(original), selected);
      const competing = {
        ...original,
        id: 'C',
        name: 'Assignment C',
        roster: ['carol'],
        expiration: 1900000000000,
        overdue: 'dock' as const,
        penalty: 10
      };
      const saving = Draft.begin(edited, competing);
      const expected =
        method === 'select'
          ? { ...selected, roster: original.roster }
          : { id: selected.id, name: selected.name };
      expect(saving.save?.changes).toEqual(expected);
      const completed = Draft.complete(saving, saving.save!, true, {
        ...competing,
        ...expected
      });
      expect(Draft.patch(completed)).toEqual({});
    }
  );

  it('retains a complete selection through a failed save and explicit retry', () => {
    const selected = {
      id: 'B',
      name: 'Assignment B',
      roster: assignment.roster.join('\n'),
      expiration: assignment.expiration,
      overdue: null,
      penalty: null
    };
    const saving = Draft.begin(
      Draft.select(Draft.create(assignment), selected),
      assignment
    );
    const competing = {
      ...assignment,
      roster: ['carol'],
      expiration: 1900000000000,
      overdue: 'dock' as const,
      penalty: 10
    };
    const failed = Draft.complete(saving, saving.save!, false, competing);
    expect(failed.phase).toBe('failed');
    const retried = Draft.select(failed, selected);
    expect(retried.version).toBe(failed.version + 1);
    expect(Draft.begin(retried, competing).save?.changes).toEqual({
      ...selected,
      roster: assignment.roster
    });
  });

  it('preserves roster and assignee reversions while a save is pending', () => {
    const pending = Draft.begin(
      Draft.edit(Draft.create(assignment), { roster: 'carol' }),
      assignment
    );
    const reverted = Draft.edit(pending, {
      roster: 'alice\nbob',
      assignee: 'alice'
    });
    const observed = Draft.observe(reverted, {
      ...assignment,
      roster: ['dave'],
      assignee: 'dave',
      name: 'External name'
    });
    expect(Draft.view(observed)).toMatchObject({
      roster: ['alice', 'bob'],
      assignee: 'alice',
      name: 'External name'
    });
    expect(observed.queued).toEqual(
      expect.arrayContaining(['roster', 'assignee'])
    );
    expect(observed.save).toBe(pending.save);
  });

  it('keeps an explicit deadline policy reset through competing updates', () => {
    const cleared = Draft.edit(Draft.create(assignment), { expiration: null });
    const reconciled = Draft.observe(cleared, {
      ...assignment,
      expiration: null
    });
    const observed = Draft.observe(reconciled, {
      ...assignment,
      expiration: null,
      overdue: 'dock',
      penalty: 10
    });
    expect(Draft.view(observed)).toMatchObject({
      expiration: null,
      overdue: null,
      penalty: null
    });
    expect(observed.queued).toEqual(
      expect.arrayContaining(['expiration', 'overdue', 'penalty'])
    );
    expect(Draft.changes(observed)).toEqual({ overdue: null, penalty: null });
  });

  it('reconciles late policy and penalty as one edited group', () => {
    const edited = Draft.edit(Draft.create(assignment), { overdue: 'reject' });
    const observed = Draft.observe(edited, {
      ...assignment,
      overdue: 'dock',
      penalty: 10,
      name: 'External name'
    });
    expect(Draft.view(observed)).toMatchObject({
      overdue: 'reject',
      penalty: null,
      name: 'External name'
    });
    expect(Draft.changes(observed)).toEqual({
      overdue: 'reject',
      penalty: null
    });
  });

  it('requires a substantive edit to retry a failed draft', () => {
    const pending = Draft.begin(
      Draft.edit(Draft.create(assignment), { name: 'Renamed' }),
      assignment
    );
    const failed = Draft.complete(pending, pending.save!, false, assignment);
    const formatted = Draft.edit(failed, { roster: ' alice\nbob\n' });
    expect(formatted.phase).toBe('failed');
    const edited = Draft.edit(formatted, { roster: 'alice' });
    expect(edited.phase).toBe('ready');
    expect(edited.version).toBe(failed.version + 1);
  });

  it('starts only one save and snapshots normalized input without losing formatting', () => {
    const clean = Draft.create(assignment);
    expect(Draft.pending(clean)).toBe(false);
    expect(Draft.begin(clean, assignment)).toBe(clean);

    const edited = Draft.edit(clean, { roster: ' carol\ncarol\n' });
    const saving = Draft.begin(edited, assignment);
    expect(saving.save?.changes).toEqual({ assignee: '', roster: ['carol'] });
    expect(saving.fields.roster).toBe(' carol\ncarol\n');
    expect(saving.fields.assignee).toBe('');
    expect(saving.queued).toEqual([]);
    expect(Draft.pending(saving)).toBe(false);
    expect(Draft.begin(saving, assignment)).toBe(saving);
    expect(Draft.retry(saving)).toBe(saving);
  });

  it('saves explicit intent even after returning to the observed baseline', () => {
    const edited = Draft.edit(Draft.create(assignment), { assignee: 'bob' });
    const reverted = Draft.edit(edited, { assignee: 'alice' });
    expect(Draft.pending(reverted)).toBe(true);
    const saving = Draft.begin(reverted, assignment);
    expect(saving.save?.changes).toEqual({ assignee: 'alice' });
    const completed = Draft.complete(saving, saving.save!, true, assignment);
    expect(Draft.pending(completed)).toBe(false);
    expect(completed.queued).toEqual([]);
  });

  it('acknowledges only the submitted patch and preserves a later reversion', () => {
    const saving = Draft.begin(
      Draft.edit(Draft.create(assignment), { assignee: 'bob' }),
      assignment
    );
    const reverted = Draft.edit(saving, { assignee: 'alice' });
    const latest = { ...assignment, assignee: 'bob', name: 'External name' };
    const completed = Draft.complete(reverted, saving.save!, true, latest);
    expect(Draft.view(completed)).toMatchObject({
      assignee: 'alice',
      name: 'External name'
    });
    expect(completed.phase).toBe('ready');
    const next = Draft.begin(completed, latest);
    expect(next.save?.changes).toEqual({ assignee: 'alice' });
    const settled = Draft.complete(next, next.save!, true, {
      ...latest,
      assignee: 'alice'
    });
    expect(Draft.patch(settled)).toEqual({});
    const observed = Draft.observe(settled, { ...latest, assignee: 'bob' });
    expect(Draft.view(observed).assignee).toBe('bob');
  });

  it.each(['none', 'continued', 'reversion'])(
    'retains failed field intent through competing observations: %s',
    edit => {
      const saving = Draft.begin(
        Draft.edit(Draft.create(assignment), { assignee: 'bob' }),
        assignment
      );
      const current =
        edit === 'none'
          ? saving
          : Draft.edit(saving, {
              assignee: edit === 'continued' ? '' : 'alice'
            });
      const failed = Draft.complete(current, saving.save!, false, {
        ...assignment,
        assignee: 'bob'
      });
      const observed = Draft.observe(failed, {
        ...assignment,
        name: 'External name'
      });
      expect(Draft.view(observed)).toMatchObject({
        assignee: edit === 'none' ? 'bob' : edit === 'continued' ? '' : 'alice',
        name: 'External name'
      });
      expect(observed.phase).toBe(edit === 'none' ? 'failed' : 'ready');
      expect(observed.queued).toContain('assignee');
      if (edit === 'none') {
        expect(Draft.begin(observed, observed.assignment)).toBe(observed);
        const retried = Draft.retry(observed);
        expect(retried.version).toBe(observed.version);
        expect(Draft.begin(retried, retried.assignment).save?.changes).toEqual({
          assignee: 'bob'
        });
      }
    }
  );

  it('retries a changed normalized patch without inventing explicit input', () => {
    const saving = Draft.begin(
      Draft.edit(Draft.create(assignment), { roster: 'alice' }),
      assignment
    );
    const latest = { ...assignment, assignee: 'bob' };
    const observed = Draft.observe(saving, latest);
    const completed = Draft.complete(observed, saving.save!, false, latest);
    expect(completed.version).toBe(saving.version);
    expect(completed.phase).toBe('ready');
    expect(Draft.begin(completed, latest).save?.changes).toEqual({
      assignee: '',
      roster: ['alice']
    });
  });

  it.each([true, false])(
    'ignores an old completion after a reset: accepted=%s',
    accepted => {
      const old = Draft.begin(
        Draft.edit(Draft.create(assignment), { assignee: 'bob' }),
        assignment
      );
      const reset = Draft.create(assignment);
      expect(Draft.complete(reset, old.save!, accepted, assignment)).toBe(
        reset
      );
      const next = Draft.begin(
        Draft.edit(reset, { assignee: 'bob' }),
        assignment
      );
      expect(next.save).not.toBe(old.save);
      expect(Draft.complete(next, old.save!, accepted, assignment)).toBe(next);
    }
  );
});
