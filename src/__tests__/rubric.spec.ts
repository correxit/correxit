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
        references: null,
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
      const reference: Rubric.Cell.Reference = {
        cell: id,
        referent: 'ref-1',
        points: 1,
        secret: true
      };
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'comparable',
          payload: null,
          points: 1,
          references: ['ref-1']
        },
        [reference]
      );
      const report: Rubric.Assignment.Report = {
        interventions: {},
        kernel: null,
        scores: { [id]: Rubric.Score.CORRECT }
      };
      const before = { ...base, assignment: { ...base.assignment, report } };
      const after = Rubric.toggle(before, 'ref-1');
      expect(before.references['ref-1'].secret).toBe(true);
      expect(after.references['ref-1'].secret).toBe(false);
      expect(after.assignment.report.scores).toEqual({});
    });

    it('removes a cell from the rubric and report', async () => {
      const id = 'cell-1';
      const rubric = Rubric.add(create(), {
        id,
        is: 'answerable',
        points: 1,
        references: null,
        payload: []
      });
      const report: Rubric.Assignment.Report = {
        interventions: {},
        kernel: null,
        scores: { [id]: Rubric.Score.CORRECT }
      };
      const signed = await Rubric.sign(rubric, report);
      const removed = Rubric.remove(signed, id);
      expect(signed.assignment.report.scores[id]).toBeDefined();
      expect(Rubric.has(removed, id)).toBe(false);
      expect(removed.assignment.report.scores).toEqual({});
      expect(removed.assignment.report.interventions).toEqual({});
    });

    it('invalidates report when removing a cell', () => {
      let rubric = create();
      rubric = Rubric.add(rubric, {
        id: 'c1',
        is: 'answerable',
        points: 1,
        references: null,
        payload: []
      });

      const report: Rubric.Assignment.Report = {
        interventions: {},
        kernel: null,
        scores: { c1: Rubric.Score.CORRECT }
      };
      rubric = { ...rubric, assignment: { ...rubric.assignment, report } };

      const removed = Rubric.remove(rubric, 'c1');
      expect(removed.assignment.report.scores).toEqual({});
    });

    it('calculates size correctly', () => {
      let rubric = create();
      expect(Rubric.size(rubric)).toBe(0);
      rubric = Rubric.add(rubric, {
        id: 'a',
        is: 'answerable',
        points: 1,
        references: null,
        payload: []
      });
      rubric = Rubric.add(rubric, {
        id: 'b',
        is: 'answerable',
        points: 1,
        references: null,
        payload: []
      });
      expect(Rubric.size(rubric)).toBe(2);
    });

    it('reweights points for an existing cell', () => {
      const id = 'cell-1';
      const base = Rubric.add(create(), {
        id,
        is: 'reviewable',
        payload: null,
        points: 1,
        references: null
      });
      const report: Rubric.Assignment.Report = {
        interventions: {},
        kernel: null,
        scores: { [id]: Rubric.Score.CORRECT }
      };
      const rubric = {
        ...base,
        assignment: {
          ...base.assignment,
          report
        }
      };

      const reweighted = Rubric.Cell.reweight(rubric, id, 7);
      expect(Rubric.get(reweighted, id)?.points).toBe(7);
      expect(Rubric.get(rubric, id)?.points).toBe(1);
      expect(reweighted.assignment.report.scores).toEqual({});
    });

    it('throws when reweighting unknown cell id', () => {
      expect(() => Rubric.Cell.reweight(create(), 'missing', 2)).toThrow(
        'reweight error'
      );
    });

    it('throws when reference.cell mismatches cell.id', () => {
      const cell: Rubric.Cell = {
        id: 'a',
        is: 'comparable',
        payload: null,
        points: 1,
        references: ['r']
      };
      const reference: Rubric.Cell.Reference = {
        cell: 'wrong',
        referent: 'r',
        points: 1,
        secret: false
      };
      expect(() => Rubric.add(create(), cell, [reference])).toThrow(
        'wrong cell'
      );
    });

    it('throws when cell.references is null but references given', () => {
      const cell: Rubric.Cell = {
        id: 'a',
        is: 'answerable',
        payload: [],
        points: 1,
        references: null
      };
      const reference: Rubric.Cell.Reference = {
        cell: 'a',
        referent: 'r',
        points: 1,
        secret: false
      };
      expect(() => Rubric.add(create(), cell, [reference])).toThrow(
        'does not accept references'
      );
    });

    it('throws when cell.references mismatches provided references', () => {
      const cell: Rubric.Cell = {
        id: 'a',
        is: 'correctable',
        payload: null,
        points: 1,
        references: ['x']
      };
      const reference: Rubric.Cell.Reference = {
        cell: 'a',
        referent: 'y',
        points: 1,
        secret: false
      };
      expect(() => Rubric.add(create(), cell, [reference])).toThrow(
        'cell.references mismatch'
      );
    });

    it('normalizes a locked rubric', async () => {
      const rubric = await Rubric.lock(create());
      const normalized = Rubric.normalize(rubric);
      expect(normalized.id).toBeDefined();
    });

    it('throws when normalizing invalid rubric', () => {
      expect(() => Rubric.normalize({})).toThrow('invalid rubric');
    });

    it('throws when report misses interventions', async () => {
      const rubric = await Rubric.lock(create());
      const invalid = {
        ...rubric,
        assignment: {
          ...rubric.assignment,
          report: {
            scores: {}
          }
        }
      };
      expect(() => Rubric.normalize(invalid as any)).toThrow(
        'missing assignment interventions'
      );
    });

    it('throws when report shape is invalid', async () => {
      const rubric = await Rubric.lock(create());
      const invalid = {
        ...rubric,
        assignment: {
          ...rubric.assignment,
          report: null
        }
      };
      expect(() => Rubric.normalize(invalid as any)).toThrow(
        'missing assignment report'
      );
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

    it('preserves expiration when reassigning', async () => {
      const assignee = 'assignee@example.com';
      const roster = [assignee, 'reassignee@example.com'];
      const expiration = Date.now() + 86400000; // 24 hours from now

      let rubric = await Rubric.assign(create(), {
        assignee,
        roster,
        expiration
      });
      expect(rubric.assignment.assignee).toBe(assignee);
      expect(rubric.assignment.expiration).toBe(expiration);

      rubric = await Rubric.assign(rubric, {
        assignee: 'reassignee@example.com',
        roster
      });
      expect(rubric.assignment.assignee).not.toBe(assignee);
      expect(rubric.assignment.expiration).toBe(expiration);
    });

    it('updates expiration when explicitly provided', async () => {
      const roster = ['assignee@example.com'];
      const initial = Date.now() + 86400000;
      const updated = Date.now() + 172800000;
      const report: Rubric.Assignment.Report = {
        interventions: {},
        kernel: null,
        scores: { c1: Rubric.Score.CORRECT }
      };

      let rubric = await Rubric.assign(create(), {
        assignee: '',
        roster,
        expiration: initial
      });
      rubric = {
        ...rubric,
        assignment: {
          ...rubric.assignment,
          report
        }
      };
      expect(rubric.assignment.expiration).toBe(initial);

      rubric = await Rubric.assign(rubric, {
        assignee: '',
        roster,
        expiration: updated
      });
      expect(rubric.assignment.expiration).toBe(updated);
      expect(rubric.assignment.report.scores).toEqual({});
    });

    it('includes expiration in signature', async () => {
      const { validate } = Rubric.Assignment;
      const expiration = Date.now() + 86400000;
      const rubric = await Rubric.assign(create(), {
        assignee: 'assignee@example.com',
        roster: ['assignee@example.com'],
        expiration
      });

      expect(rubric.assignment.expiration).toBe(expiration);
      await expect(validate(rubric)).resolves.not.toThrow();

      const tampered = {
        ...rubric,
        assignment: { ...rubric.assignment, expiration: expiration + 1000 }
      };
      await expect(validate(tampered)).rejects.toThrow('match');
    });

    it('resets lifecycle timestamps and report if any core assignment property changes', async () => {
      let rubric = create();
      const report: Rubric.Assignment.Report = {
        interventions: {},
        kernel: null,
        scores: { c1: Rubric.Score.CORRECT }
      };

      rubric = await Rubric.assign(
        {
          ...rubric,
          assignment: {
            ...rubric.assignment,
            assignee: 'A',
            certification: 1234,
            collected: 'receipt-1',
            report,
            roster: ['A', 'B'],
            submission: 1000,
            submitted: 'receipt-2'
          }
        },
        { assignee: 'A' }
      );

      expect(rubric.assignment.report.scores).toEqual(report.scores);
      expect(rubric.assignment.certification).toBe(1234);

      rubric = await Rubric.assign(rubric, { assignee: 'B' });
      expect(rubric.assignment.report.scores).toEqual({});
      expect(rubric.assignment.certification).toBeNull();
      expect(rubric.assignment.collected).toBeNull();
      expect(rubric.assignment.submission).toBeNull();
      expect(rubric.assignment.submitted).toBeNull();
    });

    it('expiration can be set to control deadline', async () => {
      const expiration = Date.now() + 86400000; // 24 hours from now
      const rubric = await Rubric.assign(create(), {
        assignee: '',
        roster: ['assignee@example.com'],
        expiration
      });

      expect(rubric.assignment.expiration).toBe(expiration);
      expect(rubric.assignment.submission).toBe(null);
    });

    it('submits a locked rubric with receipt', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: Date.now() + 86400000
      });
      const locked = await Rubric.lock(unlocked);
      const receipt = 'abc-123';
      const submitted = Rubric.submit(locked);
      const acknowledged = Rubric.acknowledge(submitted, receipt);
      expect(acknowledged.assignment.submission).toBeGreaterThan(0);
      expect(acknowledged.assignment.submitted).toBe(receipt);
      expect(acknowledged.locked).toBe(true);
    });

    it('submits a locked rubric without receipt', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null
      });
      const locked = await Rubric.lock(unlocked);
      const submitted = Rubric.submit(locked);
      expect(submitted.assignment.submission).toBeGreaterThan(0);
      expect(submitted.assignment.submitted).toBeNull();
    });

    it('drafts a submitted rubric', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null
      });
      const locked = await Rubric.lock(unlocked);
      const submitted = Rubric.submit(locked);
      const acknowledged = Rubric.acknowledge(submitted, 'receipt');
      const drafted = Rubric.draft(acknowledged);
      expect(drafted.assignment.certification).toBeNull();
      expect(drafted.assignment.submission).toBeNull();
      expect(drafted.assignment.submitted).toBeNull();
      expect(drafted.locked).toBe(true);
    });

    it('excludes submitted from signature', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null
      });
      const locked = await Rubric.lock(unlocked);
      const first = Rubric.acknowledge(Rubric.submit(locked), 'receipt-a');
      const second = Rubric.acknowledge(Rubric.submit(locked), 'receipt-b');
      expect(first.assignment.signature).toBe(second.assignment.signature);
    });

    it('collects a certified rubric with receipt', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null
      });
      const locked = await Rubric.lock(unlocked);
      const certified = {
        ...locked,
        assignment: {
          ...locked.assignment,
          certification: Date.now()
        }
      };
      const receipt = 'lms-receipt-456';
      const collected = Rubric.collect(certified, receipt);
      expect(collected.assignment.certification).toBeGreaterThan(0);
      expect(collected.assignment.collected).toBe(receipt);
    });

    it('collects a certified rubric without receipt', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null
      });
      const locked = await Rubric.lock(unlocked);
      const certified = {
        ...locked,
        assignment: {
          ...locked.assignment,
          certification: Date.now()
        }
      };
      const collected = Rubric.collect(certified);
      expect(collected.assignment.collected).toBeNull();
    });

    it('collect rejects uncertified rubric', async () => {
      const unlocked = await Rubric.assign(create(), {
        assignee: 'student@example.com',
        roster: ['student@example.com'],
        expiration: null
      });
      const locked = await Rubric.lock(unlocked);
      expect(() => Rubric.collect(locked)).toThrow(
        'collect error: not certified'
      );
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
          references: null,
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
      const populate = (id: string, referent: string) => {
        const cell: Rubric.Cell = {
          id,
          is: 'comparable',
          points: 1,
          references: [referent],
          payload: null
        };
        const references: Rubric.Cell.Reference[] = [
          { cell: id, referent, points: 1, secret: false }
        ];
        return Rubric.add(create(), cell, references);
      };

      it('scores correct when JSON data matches', async () => {
        const id = 'student';
        const referent = 'teacher';
        const rubric = populate(id, referent);
        const outputs = new Map([
          [id, [data({ foo: 1 })]],
          [referent, [data({ foo: 1 })]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('correct');
      });

      it('scores incorrect when JSON data differs', async () => {
        const id = 'student';
        const referent = 'teacher';
        const rubric = populate(id, referent);
        const outputs = new Map([
          [id, [data({ foo: 2 })]],
          [referent, [data({ foo: 1 })]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('incorrect');
        expect(score.code).toBe('mismatch-data');
      });

      it('scores incorrect if keys (MIME types) differ', async () => {
        const id = 's';
        const referent = 't';
        const rubric = populate(id, referent);
        const outputs = new Map([
          [id, [output('foo')]],
          [referent, [data({})]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.code).toBe('mismatch-congruence');
      });

      it('handles missing reference output', async () => {
        const id = 's';
        const referent = 't';
        const rubric = populate(id, referent);
        const outputs = new Map([[id, [data({})]]]); // referent is missing
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.code).toBe('missing-reference');
      });
    });

    describe('Correctable (Reference Execution)', () => {
      const populate = (id: string, referent: string) => {
        const cell: Rubric.Cell = {
          id,
          is: 'correctable',
          points: 1,
          references: [referent],
          payload: null
        };
        const references: Rubric.Cell.Reference[] = [
          { cell: id, referent, points: 1, secret: false }
        ];
        return Rubric.add(create(), cell, references);
      };

      it('scores correct if reference cell has no errors', async () => {
        const id = 's';
        const referent = 't';
        const rubric = populate(id, referent);
        const outputs = new Map([
          [id, []],
          [referent, [output('Test Passed')]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('correct');
      });

      it('scores incorrect if reference cell has error', async () => {
        const id = 's';
        const referent = 't';
        const rubric = populate(id, referent);
        const outputs = new Map([
          [id, []],
          [referent, [error('AssertionError')]]
        ]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('incorrect');
      });

      it('surfaces missing-reference for absent output', async () => {
        const id = 's';
        const referent = 't';
        const rubric = populate(id, referent);
        const outputs: Rubric.Outputs = new Map([[id, []]]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.code).toBe('missing-reference');
        expect(score.points).toBe(0);
      });
    });

    describe('Reviewable (Manual Intervention)', () => {
      const populate = (id: string) => {
        const cell: Rubric.Cell = {
          id,
          is: 'reviewable',
          payload: null,
          points: 5,
          references: null
        };
        return Rubric.add(create(), cell);
      };

      it('returns unscored with intervene code when no intervention', async () => {
        const id = 'q1';
        const rubric = populate(id);
        const outputs = new Map([[id, [output('anything')]]]);
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('unscored');
        expect(score.code).toBe('intervene');
        expect(score.id).toBe(id);
        expect(score.possible).toBe(5);
      });

      it('returns unscored even when outputs are empty', async () => {
        const id = 'q1';
        const rubric = populate(id);
        const outputs: Rubric.Outputs = new Map();
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('unscored');
        expect(score.code).toBe('intervene');
      });

      it('resolves to the intervention score when one exists', async () => {
        const id = 'q1';
        const intervention: Rubric.Score = {
          ...Rubric.Score.CORRECT,
          id,
          points: 5,
          possible: 5
        };
        const rubric = {
          ...populate(id),
          assignment: {
            ...populate(id).assignment,
            report: {
              ...populate(id).assignment.report,
              interventions: { [id]: intervention }
            }
          }
        };
        const outputs: Rubric.Outputs = new Map();
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('correct');
        expect(score.points).toBe(5);
        expect(score.id).toBe(id);
      });

      it('preserves partial points from intervention', async () => {
        const id = 'q1';
        const intervention = Rubric.Score.intervene(id, {
          comment: 'partial credit',
          points: 3,
          possible: 5
        });
        const rubric = {
          ...populate(id),
          assignment: {
            ...populate(id).assignment,
            report: {
              ...populate(id).assignment.report,
              interventions: { [id]: intervention }
            }
          }
        };
        const outputs: Rubric.Outputs = new Map();
        const score = await Rubric.Cell.score(rubric, id, outputs);
        expect(score.status).toBe('partial');
        expect(score.points).toBe(3);
        expect(score.possible).toBe(5);
      });
    });
  });

  describe('Rubric.Assignment', () => {
    it('scores cells and generates a report', async () => {
      const payload = ['DIGEST<42>'];
      const add = (rubric: Rubric.Unlocked) =>
        Rubric.add(rubric, {
          id: 'c1',
          is: 'answerable',
          points: 1,
          references: null,
          payload
        });
      const rubric = add(create());

      const outputs = new Map([['c1', [output('42')]]]);
      const report = await Rubric.Assignment.score(rubric, outputs);

      expect(report.scores.c1).toBeDefined();
      expect(report.scores.c1.status).toBe('correct');
    });

    it('scores multiple cells and generates a report', async () => {
      let rubric = create();
      rubric = Rubric.add(rubric, {
        id: 'c1',
        is: 'answerable',
        points: 1,
        references: null,
        payload: ['DIGEST<A>']
      });
      rubric = Rubric.add(rubric, {
        id: 'c2',
        is: 'answerable',
        points: 1,
        references: null,
        payload: ['DIGEST<B>']
      });

      const outputs = new Map([
        ['c1', [output('A')]],
        ['c2', [output('B')]]
      ]);
      const report = await Rubric.Assignment.score(rubric, outputs);
      expect(report.scores['c1'].status).toBe('correct');
      expect(report.scores['c2'].status).toBe('correct');
    });

    it('merges new scores with existing valid scores', async () => {
      let rubric = create();
      const add = (id: string, text: string) =>
        (rubric = Rubric.add(rubric, {
          id,
          is: 'answerable',
          points: 1,
          references: null,
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
      expect(updated.scores['c1'].status).toBe('incorrect');
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
          references: null,
          payload: []
        }));
      add('c1');
      add('c2');

      const report: Rubric.Assignment.Report = {
        interventions: {},
        kernel: null,
        scores: {
          c1: Rubric.Score.CORRECT,
          c2: Rubric.Score.CORRECT,
          ghost: Rubric.Score.CORRECT
        }
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
        interventions: {},
        kernel: null,
        scores: {
          c1: { ...Rubric.Score.CORRECT, points: 5, possible: 5 },
          c2: { ...Rubric.Score.INCORRECT, points: 0, possible: 10 }
        }
      };
      const summary = Rubric.Assignment.summary(report);
      expect(summary.points).toBe(5);
      expect(summary.possible).toBe(15);
      expect(summary.status).toBe('summary');
    });
  });

  describe('Rubric.Score', () => {
    it('creates manual intervention score', () => {
      const intervention = Rubric.Score.intervene('c1', {
        comment: 'manual override',
        points: 3,
        possible: 5
      });

      expect(intervention.id).toBe('c1');
      expect(intervention.code).toBe('intervene');
      expect(intervention.comment).toBe('manual override');
      expect(intervention.points).toBe(3);
      expect(intervention.possible).toBe(5);
      expect(intervention.status).toBe('partial');
    });

    it('resolves intervention over computed score', () => {
      const report: Rubric.Assignment.Report = {
        interventions: {
          c1: Rubric.Score.intervene('c1', {
            comment: 'manual override',
            points: 4,
            possible: 5
          })
        },
        kernel: null,
        scores: {
          c1: { ...Rubric.Score.CORRECT, id: 'c1', points: 5, possible: 5 }
        }
      };

      const resolved = Rubric.Score.resolve(report, 'c1');
      expect(resolved?.code).toBe('intervene');
      expect(resolved?.points).toBe(4);
    });

    it('rejects negative points', () => {
      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: -1,
          possible: 5
        })
      ).toThrow(RangeError);

      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: -1,
          possible: 5
        })
      ).toThrow('points out of range');
    });

    it('rejects points greater than possible', () => {
      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: 6,
          possible: 5
        })
      ).toThrow(RangeError);

      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: 6,
          possible: 5
        })
      ).toThrow('points out of range');
    });

    it('rejects non-positive possible', () => {
      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: 0,
          possible: 0
        })
      ).toThrow(RangeError);

      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: 0,
          possible: 0
        })
      ).toThrow('possible < 1');
    });

    it('rejects non-finite and non-integer values', () => {
      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: Number.NaN,
          possible: 5
        })
      ).toThrow(TypeError);

      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: Number.NaN,
          possible: 5
        })
      ).toThrow('points invalid');

      expect(() =>
        Rubric.Score.intervene('c1', {
          comment: '',
          points: 2.5,
          possible: 5
        })
      ).toThrow(TypeError);
    });
  });

  describe('References', () => {
    it('adds a reference to an existing correctable cell', () => {
      const id = 'cell-1';
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 1,
          references: ['ref-1']
        },
        [{ cell: id, referent: 'ref-1', points: 1, secret: true }]
      );

      const reference: Rubric.Cell.Reference = {
        cell: id,
        referent: 'ref-2',
        points: 2,
        secret: false
      };
      const rubric = Rubric.refer(base, id, reference);
      const cell = Rubric.get(rubric, id)!;
      expect(cell.references).toEqual(['ref-1', 'ref-2']);
      expect(cell.points).toBe(3);
      expect(rubric.references['ref-2']).toEqual(reference);
      expect(rubric.assignment.report.scores).toEqual({});
    });

    it('recomputes correctable points when adding references', () => {
      const id = 'cell-1';
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 1,
          references: ['ref-1']
        },
        [{ cell: id, referent: 'ref-1', points: 1, secret: true }]
      );
      const stale = {
        ...base,
        cells: {
          ...base.cells,
          [id]: { ...base.cells[id], points: 9 }
        }
      } as Rubric.Unlocked;

      const rubric = Rubric.refer(stale, id, {
        cell: id,
        referent: 'ref-2',
        points: 2,
        secret: false
      });
      expect(Rubric.get(rubric, id)!.points).toBe(3);
    });

    it('refer preserves points for comparable cells', () => {
      const id = 'cell-1';
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'comparable',
          payload: null,
          points: 5,
          references: ['ref-1']
        },
        [{ cell: id, referent: 'ref-1', points: 1, secret: false }]
      );

      const reference: Rubric.Cell.Reference = {
        cell: id,
        referent: 'ref-2',
        points: 1,
        secret: false
      };
      const rubric = Rubric.refer(base, id, reference);
      expect(Rubric.get(rubric, id)!.points).toBe(5);
    });

    it('refer rejects duplicate referent', () => {
      const id = 'cell-1';
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 1,
          references: ['ref-1']
        },
        [{ cell: id, referent: 'ref-1', points: 1, secret: true }]
      );

      expect(() =>
        Rubric.refer(base, id, {
          cell: id,
          referent: 'ref-1',
          points: 1,
          secret: true
        })
      ).toThrow('already exists');
    });

    it('dereferences a single reference, cell preserved', () => {
      const id = 'cell-1';
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 2,
          references: ['ref-1', 'ref-2']
        },
        [
          { cell: id, referent: 'ref-1', points: 1, secret: true },
          { cell: id, referent: 'ref-2', points: 1, secret: false }
        ]
      );

      const rubric = Rubric.dereference(base, 'ref-1');
      const cell = Rubric.get(rubric, id)!;
      expect(cell.references).toEqual(['ref-2']);
      expect(cell.points).toBe(1);
      expect(rubric.references['ref-1']).toBeUndefined();
      expect(rubric.references['ref-2']).toBeDefined();
    });

    it('recomputes correctable points when removing references', () => {
      const id = 'cell-1';
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 2,
          references: ['ref-1', 'ref-2']
        },
        [
          { cell: id, referent: 'ref-1', points: 1, secret: true },
          { cell: id, referent: 'ref-2', points: 1, secret: false }
        ]
      );
      const stale = {
        ...base,
        cells: {
          ...base.cells,
          [id]: { ...base.cells[id], points: 9 }
        }
      } as Rubric.Unlocked;

      const rubric = Rubric.dereference(stale, 'ref-1');
      expect(Rubric.get(rubric, id)!.points).toBe(1);
    });

    it('dereferences last reference, removes cell', () => {
      const id = 'cell-1';
      const base = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 1,
          references: ['ref-1']
        },
        [{ cell: id, referent: 'ref-1', points: 1, secret: true }]
      );

      const rubric = Rubric.dereference(base, 'ref-1');
      expect(Rubric.has(rubric, id)).toBe(false);
      expect(rubric.references['ref-1']).toBeUndefined();
    });

    it('scores correctable with multiple references', async () => {
      const id = 'cell-1';
      const rubric = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 3,
          references: ['ref-1', 'ref-2', 'ref-3']
        },
        [
          { cell: id, referent: 'ref-1', points: 1, secret: false },
          { cell: id, referent: 'ref-2', points: 1, secret: false },
          { cell: id, referent: 'ref-3', points: 1, secret: false }
        ]
      );

      const outputs = new Map([
        [id, []],
        ['ref-1', [output('pass')]],
        ['ref-2', [error('fail')]],
        ['ref-3', [output('pass')]]
      ]);
      const score = await Rubric.Cell.score(rubric, id, outputs);
      expect(score.status).toBe('partial');
      expect(score.points).toBe(2);
      expect(score.possible).toBe(3);
    });

    it('scores only visible references when locked', async () => {
      const id = 'cell-1';
      const unlocked = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 2,
          references: ['ref-1', 'ref-2']
        },
        [
          { cell: id, referent: 'ref-1', points: 1, secret: true },
          { cell: id, referent: 'ref-2', points: 1, secret: false }
        ]
      );

      const locked = await Rubric.lock(unlocked);
      const outputs = new Map([
        [id, []],
        ['ref-1', [output('pass')]],
        ['ref-2', [output('pass')]]
      ]);
      const score = await Rubric.Cell.score(locked, id, outputs);
      // Only ref-2 is visible; ref-1 is secret.
      expect(score.points).toBe(1);
      expect(score.possible).toBe(1);
      expect(score.status).toBe('correct');
    });

    it('returns locked when all references are secret', async () => {
      const id = 'cell-1';
      const unlocked = Rubric.add(
        create(),
        {
          id,
          is: 'correctable',
          payload: null,
          points: 1,
          references: ['ref-1']
        },
        [{ cell: id, referent: 'ref-1', points: 1, secret: true }]
      );

      const locked = await Rubric.lock(unlocked);
      const outputs = new Map([
        [id, []],
        ['ref-1', [output('pass')]]
      ]);
      const score = await Rubric.Cell.score(locked, id, outputs);
      expect(score.code).toBe('locked');
      expect(score.status).toBe('incorrect');
    });
  });
});
