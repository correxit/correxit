declare const require: any;
jest.mock('../correxit/security', () => require('./mocks/security'));
import { Rubric } from '../correxit/rubric';

describe('Rubric', () => {
  beforeEach(() => jest.clearAllMocks());

  const create = (): Rubric.Unlocked => ({ ...Rubric.create(), key: 'secret' });
  const output = (text: string): Rubric.Cell.Output =>
    ({
      content: { name: 'stdout', text },
      header: { msg_type: 'stream' }
    }) as any;
  const error = (evalue: string): Rubric.Cell.Output =>
    ({
      content: { ename: 'Error', evalue, traceback: [] },
      header: { msg_type: 'error' }
    }) as any;
  const data = (data: any): Rubric.Cell.Output =>
    ({
      content: { data, metadata: {} },
      header: { msg_type: 'execute_result' }
    }) as any;

  describe('Lifecycle & Manipulation', () => {
    it('locks and unlocks data symmetrically', async () => {
      const id = 'test-cell';
      const cell: Rubric.Cell = {
        id,
        is: 'answerable',
        points: 5,
        reference: null,
        shared: false,
        payload: ['42']
      };
      const rubric = Rubric.add(create(), cell);
      const { key } = rubric;
      const locked = await Rubric.lock(rubric);
      const unlocked = await Rubric.unlock(locked, key);
      expect(locked.locked).toBe(true);
      expect(locked.key).toBeNull();
      expect(unlocked.locked).toBe(false);
      expect(Rubric.get(unlocked, id)!.payload).toEqual(['42']);
    });

    it('toggles a cell between shared and secret', () => {
      const id = 'cell-1';
      const secret = Rubric.add(create(), {
        id,
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      const shared = Rubric.toggle(secret, id);
      expect(secret.cells[id]).toBeDefined();
      expect(secret.cells[id].shared).toBe(false);
      expect(shared.cells[id]).toBeDefined();
      expect(shared.cells[id].shared).toBe(true);
    });

    it('removes a cell from the rubric and report', async () => {
      const id = 'cell-1';
      const rubric = Rubric.add(create(), {
        id,
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      const report: Rubric.Assignment.Report = {
        order: [id],
        scores: { [id]: Rubric.Score.CORRECT },
        timestamp: Date.now()
      };
      const signed = await Rubric.sign(rubric, report);
      const removed = Rubric.remove(signed, id);
      expect(signed.assignment.report.scores[id]).toBeDefined();
      expect(Rubric.has(removed, id)).toBe(false);
      // Report scores are NOT cleaned up by remove()
      expect(removed.assignment.report.scores[id]).toBeDefined();
    });

    it('preserves report when removing a cell', () => {
      let rubric = create();
      rubric = Rubric.add(rubric, {
        id: 'c1',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });

      const report: Rubric.Assignment.Report = {
        order: ['c1'],
        scores: { c1: Rubric.Score.CORRECT },
        timestamp: Date.now()
      };
      rubric = { ...rubric, assignment: { ...rubric.assignment, report } };

      const removed = Rubric.remove(rubric, 'c1');
      // Report data persists after removal
      expect(removed.assignment.report.order).toEqual(['c1']);
      expect(removed.assignment.report.scores.c1).toBeDefined();
    });

    it('calculates size correctly', () => {
      let rubric = create();
      expect(Rubric.size(rubric)).toBe(0);
      rubric = Rubric.add(rubric, {
        id: 'a',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      rubric = Rubric.add(rubric, {
        id: 'b',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: true,
        payload: []
      });
      expect(Rubric.size(rubric)).toBe(2);
    });

    it('normalizes a locked rubric', async () => {
      const rubric = await Rubric.lock(create());
      const normalized = Rubric.normalize(rubric);
      expect(normalized.id).toBeDefined();
    });

    it('throws when normalizing invalid rubric', () => {
      expect(() => Rubric.normalize({})).toThrow('invalid rubric');
    });
  });

  describe('Assignment Flow', () => {
    it('assigns to a student and validates signature', async () => {
      const { validate } = Rubric.Assignment;
      const assignee = 'assignee@example.com';
      const roster = [assignee];
      const rubric = await Rubric.assign(create(), { assignee, roster });
      expect(rubric.assignment.assignee).toBe(assignee);
      expect(rubric.assignment.signature).toBeTruthy();
      await expect(validate(rubric)).resolves.not.toThrow();
    });

    it('fails validation if signature is tampered', async () => {
      const { validate } = Rubric.Assignment;
      const assignee = 'assignee@example.com';
      const hacker = 'hacker@example.com';
      const rubric = await Rubric.assign(create(), {
        assignee,
        roster: [assignee]
      });
      const assignment = { ...rubric.assignment, assignee: hacker };
      const tampered = { ...rubric, assignment };
      await expect(validate(tampered)).rejects.toThrow('match');
    });

    it('preserves expiration and submission when reassigning', async () => {
      const assignee = 'assignee@example.com';
      const roster = [assignee, 'reassignee@example.com'];
      const expiration = Date.now() + 86400000; // 24 hours from now
      const submission = null;

      let rubric = await Rubric.assign(create(), {
        assignee,
        roster,
        expiration,
        submission
      });
      expect(rubric.assignment.assignee).toBe(assignee);
      expect(rubric.assignment.expiration).toBe(expiration);
      expect(rubric.assignment.submission).toBe(null);

      // Reassign without providing expiration/submission
      rubric = await Rubric.assign(rubric, {
        assignee: 'reassignee@example.com',
        roster
      });
      expect(rubric.assignment.assignee).not.toBe(assignee);
      expect(rubric.assignment.expiration).toBe(expiration);
      expect(rubric.assignment.submission).toBe(null);
    });

    it('updates expiration when explicitly provided', async () => {
      const roster = ['assignee@example.com'];
      const initial = Date.now() + 86400000;
      const updated = Date.now() + 172800000;

      let rubric = await Rubric.assign(create(), {
        assignee: '',
        roster,
        expiration: initial,
        submission: null
      });
      expect(rubric.assignment.expiration).toBe(initial);

      rubric = await Rubric.assign(rubric, {
        assignee: '',
        roster,
        expiration: updated,
        submission: null
      });
      expect(rubric.assignment.expiration).toBe(updated);
    });

    it('includes expiration and submission in signature', async () => {
      const { validate } = Rubric.Assignment;
      const expiration = Date.now() + 86400000;
      const submission = Date.now();
      const rubric = await Rubric.assign(create(), {
        assignee: 'assignee@example.com',
        roster: ['assignee@example.com'],
        expiration,
        submission
      });

      expect(rubric.assignment.expiration).toBe(expiration);
      expect(rubric.assignment.submission).toBe(submission);
      await expect(validate(rubric)).resolves.not.toThrow();

      // Tampering with expiration should fail validation
      const tampered = {
        ...rubric,
        assignment: { ...rubric.assignment, expiration: expiration + 1000 }
      };
      await expect(validate(tampered)).rejects.toThrow('match');
    });

    it('allows updating submission timestamp', async () => {
      const roster = ['assignee@example.com'];
      const expiration = Date.now() + 86400000;

      let rubric = await Rubric.assign(create(), {
        assignee: 'assignee@example.com',
        roster,
        expiration,
        submission: null
      });
      expect(rubric.assignment.submission).toBe(null);

      // Student submits
      const timestamp = Date.now();
      rubric = await Rubric.assign(rubric, {
        assignee: 'assignee@example.com',
        roster,
        submission: timestamp
      });
      expect(rubric.assignment.submission).toBe(timestamp);
      expect(rubric.assignment.expiration).toBe(expiration); // Should preserve
    });

    it('resets report if assignee changes', async () => {
      let rubric = create();
      const report = {
        order: ['cell-1'],
        scores: { 'cell-1': Rubric.Score.CORRECT },
        timestamp: Date.now()
      };
      const roster = ['A', 'B'];

      rubric = await Rubric.assign(
        {
          ...rubric,
          assignment: { ...rubric.assignment, assignee: 'A', report, roster }
        },
        { assignee: 'A' }
      );
      expect(rubric.assignment.report.scores).toEqual(report.scores);

      rubric = await Rubric.assign(rubric, { assignee: 'B' });
      expect(rubric.assignment.report.scores).toEqual({});
      expect(rubric.assignment.report.order).toEqual([]);
    });

    it('expiration can be set to control deadline', async () => {
      const expiration = Date.now() + 86400000; // 24 hours from now
      const rubric = await Rubric.assign(create(), {
        assignee: '',
        roster: ['assignee@example.com'],
        expiration,
        submission: null
      });

      expect(rubric.assignment.expiration).toBe(expiration);
      expect(rubric.assignment.submission).toBe(null);
    });

    it('submits a locked rubric with confirmation', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: Date.now() + 86400000,
        submission: null
      });
      const locked = await Rubric.lock(unlocked);
      const receipt = 'abc-123';
      const submitted = Rubric.submit(locked, receipt);
      expect(submitted.assignment.submission).toBeGreaterThan(0);
      expect(submitted.assignment.confirmation).toBe(receipt);
      expect(submitted.locked).toBe(true);
    });

    it('submits a locked rubric without confirmation', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null,
        submission: null
      });
      const locked = await Rubric.lock(unlocked);
      const submitted = Rubric.submit(locked);
      expect(submitted.assignment.submission).toBeGreaterThan(0);
      expect(submitted.assignment.confirmation).toBeNull();
    });

    it('drafts a submitted rubric', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null,
        submission: null
      });
      const locked = await Rubric.lock(unlocked);
      const submitted = Rubric.submit(locked, 'receipt');
      const drafted = Rubric.draft(submitted);
      expect(drafted.assignment.submission).toBeNull();
      expect(drafted.assignment.confirmation).toBeNull();
      expect(drafted.locked).toBe(true);
    });

    it('excludes confirmation from signature', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null,
        submission: null
      });
      const locked = await Rubric.lock(unlocked);
      const first = Rubric.submit(locked, 'receipt-a');
      const second = Rubric.submit(locked, 'receipt-b');
      expect(first.assignment.signature).toBe(second.assignment.signature);
    });
  });

  describe('Rubric.Cell.score', () => {
    describe('Answerable (Digest Match)', () => {
      const populate = (id: string, text: string) => {
        const digest = `DIGEST<${text}>`;
        const cell: Rubric.Cell = {
          id,
          is: 'answerable',
          points: 1,
          reference: null,
          shared: false,
          payload: [digest]
        };
        return Rubric.add(create(), cell);
      };

      it('scores correct output', async () => {
        const id = 'q1';
        const rubric = populate(id, '42');
        const outputs = new Map([[id, [output('42')]]]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('correct');
      });

      it('scores incorrect output', async () => {
        const id = 'q1';
        const rubric = populate(id, '42');
        const outputs = new Map([[id, [output('99')]]]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('incorrect');
        expect(score.code).toBe('mismatch-digest');
      });

      it('handles empty given', async () => {
        const id = 'q1';
        const rubric = populate(id, '42');
        const outputs = new Map([[id, []]]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('incorrect');
        expect(score.code).toBe('empty-given');
      });

      it('returns score with correct id', async () => {
        const id = 'q1';
        const rubric = populate(id, '42');
        const outputs = new Map([[id, [output('42')]]]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.id).toBe(id);
      });
    });

    describe('Comparable (Exact Match)', () => {
      const populate = (id: string, ref: string) => {
        const cell: Rubric.Cell = {
          id,
          is: 'comparable',
          points: 1,
          reference: [ref],
          shared: false,
          payload: null
        };
        return Rubric.add(create(), cell);
      };

      it('scores correct when JSON data matches', async () => {
        const id = 'student';
        const ref = 'teacher';
        const rubric = populate(id, ref);
        const outputs = new Map([
          [id, [data({ foo: 1 })]],
          [ref, [data({ foo: 1 })]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('correct');
      });

      it('scores incorrect when JSON data differs', async () => {
        const id = 'student';
        const ref = 'teacher';
        const rubric = populate(id, ref);
        const outputs = new Map([
          [id, [data({ foo: 2 })]],
          [ref, [data({ foo: 1 })]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('incorrect');
        expect(score.code).toBe('mismatch-data');
      });

      it('scores incorrect if keys (MIME types) differ', async () => {
        const id = 's';
        const ref = 't';
        const rubric = populate(id, ref);
        const outputs = new Map([
          [id, [output('foo')]],
          [ref, [data({})]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.code).toBe('mismatch-congruence');
      });

      it('handles missing reference output', async () => {
        const id = 's';
        const ref = 't';
        const rubric = populate(id, ref);
        const outputs = new Map([[id, [data({})]]]); // ref is missing
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.code).toBe('missing-reference');
      });
    });

    describe('Correctable (Reference Execution)', () => {
      const populate = (id: string, ref: string) => {
        const cell: Rubric.Cell = {
          id,
          is: 'correctable',
          points: 1,
          reference: [ref],
          shared: false,
          payload: null
        };
        return Rubric.add(create(), cell);
      };

      it('scores correct if reference cell has no errors', async () => {
        const id = 's';
        const ref = 't';
        const rubric = populate(id, ref);
        const outputs = new Map([
          [id, []],
          [ref, [output('Test Passed')]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('correct');
      });

      it('scores incorrect if reference cell has error', async () => {
        const id = 's';
        const ref = 't';
        const rubric = populate(id, ref);
        const outputs = new Map([
          [id, []],
          [ref, [error('AssertionError')]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('incorrect');
      });
    });
  });

  describe('Rubric.Assignment', () => {
    it('sets report.timestamp when scoring', async () => {
      const payload = ['DIGEST<42>'];
      const add = (rubric: Rubric.Unlocked) =>
        Rubric.add(rubric, {
          id: 'c1',
          is: 'answerable',
          points: 1,
          reference: null,
          shared: false,
          payload
        });
      const rubric = add(create());

      const start = Date.now();
      const outputs = new Map([['c1', [output('42')]]]);
      const report = await Rubric.Assignment.score(rubric, outputs);
      const end = Date.now();

      expect(report.timestamp).not.toBeNull();
      expect(report.timestamp).toBeGreaterThanOrEqual(start);
      expect(report.timestamp).toBeLessThanOrEqual(end);
    });

    it('scores multiple cells and generates a report', async () => {
      let rubric = create();
      rubric = Rubric.add(rubric, {
        id: 'c1',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: ['DIGEST<A>']
      });
      rubric = Rubric.add(rubric, {
        id: 'c2',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: ['DIGEST<B>']
      });

      const outputs = new Map([
        ['c1', [output('A')]],
        ['c2', [output('B')]]
      ]);
      const report = await Rubric.Assignment.score(rubric, outputs);
      expect(report.scores['c1'].status).toBe('correct');
      expect(report.scores['c2'].status).toBe('correct');
      expect(report.order).toEqual(['c1', 'c2']);
    });

    it('preserves order from notebook execution', async () => {
      let rubric = create();
      rubric = Rubric.add(rubric, {
        id: 'c3',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      rubric = Rubric.add(rubric, {
        id: 'c2',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      rubric = Rubric.add(rubric, {
        id: 'c1',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      const outputs = new Map([
        ['c1', [output('1')]],
        ['c3', [output('3')]],
        ['c2', [output('2')]]
      ]);
      const report = await Rubric.Assignment.score(rubric, outputs);
      expect(report.order).toEqual(['c1', 'c3', 'c2']);
    });

    it('updates order when cells are moved and re-scored', async () => {
      let rubric = create();
      rubric = Rubric.add(rubric, {
        id: 'c1',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      rubric = Rubric.add(rubric, {
        id: 'c2',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      rubric = Rubric.add(rubric, {
        id: 'c3',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      let outputs = new Map([
        ['c1', [output('1')]],
        ['c2', [output('2')]],
        ['c3', [output('3')]]
      ]);
      rubric = {
        ...rubric,
        assignment: {
          ...rubric.assignment,
          report: await Rubric.Assignment.score(rubric, outputs)
        }
      };
      expect(rubric.assignment.report.order).toEqual(['c1', 'c2', 'c3']);
      // New execution order 3 -> 1 -> 2
      outputs = new Map([
        ['c3', [output('3')]],
        ['c1', [output('1')]],
        ['c2', [output('2')]]
      ]);
      const report = await Rubric.Assignment.score(rubric, outputs);
      expect(report.order).toEqual(['c3', 'c1', 'c2']);
    });

    it('preserves order when updating a single cell score', async () => {
      let rubric = create();
      rubric = Rubric.add(rubric, {
        id: 'c1',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      rubric = Rubric.add(rubric, {
        id: 'c2',
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });

      const outputs = new Map([
        ['c1', [output('1')]],
        ['c2', [output('2')]]
      ]);
      let report = await Rubric.Assignment.score(rubric, outputs);
      rubric = { ...rubric, assignment: { ...rubric.assignment, report } };
      expect(report.order).toEqual(['c1', 'c2']);

      const updates: Rubric.Outputs = new Map([['c2', [output('2-new')]]]);
      report = await Rubric.Assignment.score(rubric, updates, 'c2');
      expect(report.order).toEqual(['c1', 'c2']);
    });

    it('merges new scores with existing valid scores', async () => {
      let rubric = create();
      const add = (id: string, text: string) =>
        (rubric = Rubric.add(rubric, {
          id,
          is: 'answerable',
          points: 1,
          reference: null,
          shared: false,
          payload: [`DIGEST<${text}>`]
        }));
      add('c1', 'A');
      add('c2', 'B');
      add('c3', 'C');

      const initial = new Map([
        ['c1', [output('A')]],
        ['c2', [output('Wrong')]]
      ]);
      const original = await Rubric.Assignment.score(rubric, initial);
      rubric = {
        ...rubric,
        assignment: { ...rubric.assignment, report: original }
      };

      const subsequent = new Map([
        ['c2', [output('B')]],
        ['c3', [output('C')]]
      ]);
      const updated = await Rubric.Assignment.score(rubric, subsequent);
      expect(updated.scores['c1'].status).toBe('correct');
      expect(updated.scores['c2'].status).toBe('correct');
      expect(updated.scores['c3'].status).toBe('correct');
      expect(Object.keys(updated.scores).length).toBe(3);
    });

    it('prunes orphaned scores during scoring', async () => {
      let rubric = create();
      const add = (id: string) =>
        (rubric = Rubric.add(rubric, {
          id,
          is: 'answerable',
          points: 1,
          reference: null,
          shared: false,
          payload: []
        }));
      add('c1');
      add('c2');

      const report: Rubric.Assignment.Report = {
        order: ['c1', 'c2', 'ghost'],
        scores: {
          c1: Rubric.Score.CORRECT,
          c2: Rubric.Score.CORRECT,
          ghost: Rubric.Score.CORRECT
        },
        timestamp: null
      };
      rubric = { ...rubric, assignment: { ...rubric.assignment, report } };

      const outputs = new Map([['c2', [output('X')]]]);
      const report2 = await Rubric.Assignment.score(rubric, outputs, 'c2');
      expect(report2.scores.c1).toBeDefined();
      expect(report2.scores.c2).toBeDefined();
      expect(report2.scores.ghost).toBeUndefined();
    });

    it('summarizes a report correctly', () => {
      const report: Rubric.Assignment.Report = {
        order: ['c1', 'c2'],
        scores: {
          c1: { ...Rubric.Score.CORRECT, points: 5, possible: 5 },
          c2: { ...Rubric.Score.INCORRECT, points: 0, possible: 10 }
        },
        timestamp: null
      };
      const summary = Rubric.Assignment.summary(report);
      expect(summary.points).toBe(5);
      expect(summary.possible).toBe(15);
      expect(summary.status).toBe('summary');
    });
  });
});
