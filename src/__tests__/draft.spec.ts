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
    const observed = Draft.observe(reverted, {
      ...assignment,
      assignee: 'bob'
    });
    expect(Draft.view(observed).assignee).toBe('alice');
    expect(observed.queued).toContain('assignee');
    expect(Draft.changes(observed)).toEqual({ assignee: 'alice' });
  });

  it('preserves roster and assignee reversions while a save is pending', () => {
    const pending: Draft.State = {
      ...Draft.create(assignment),
      fields: {
        ...Draft.create(assignment).fields,
        roster: 'carol',
        assignee: ''
      },
      version: 1,
      phase: 'saving',
      save: { version: 1, changes: { roster: ['carol'], assignee: '' } }
    };
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
    const failed: Draft.State = {
      ...Draft.create(assignment),
      phase: 'failed',
      save: null
    };
    const formatted = Draft.edit(failed, { roster: ' alice\nbob\n' });
    expect(formatted.phase).toBe('failed');
    const edited = Draft.edit(formatted, { roster: 'alice' });
    expect(edited.phase).toBe('ready');
    expect(edited.version).toBe(1);
  });
});
