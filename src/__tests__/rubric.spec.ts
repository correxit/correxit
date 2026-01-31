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
      expect(locked.secret).toContain(`ENC[${key}]:`);
      expect(unlocked.locked).toBe(false);
      expect(Rubric.get(unlocked, id)!.payload).toEqual(['42']);
    });

    it('toggles a cell between shared and secret', () => {
      const id = 'cell-1';
      const untoggled = Rubric.add(create(), {
        id,
        is: 'answerable',
        points: 1,
        reference: null,
        shared: false,
        payload: []
      });
      const toggled = Rubric.toggle(untoggled, id);
      expect(untoggled.secret.cells[id]).toBeDefined();
      expect(untoggled.shared.cells[id]).toBeUndefined();
      expect(toggled.secret.cells[id]).toBeUndefined();
      expect(toggled.shared.cells[id]).toBeDefined();
      expect(toggled.shared.cells[id].shared).toBe(true);
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
      const report: Rubric.Assignment.Report = { [id]: Rubric.Score.CORRECT };
      const signed = await Rubric.sign(rubric, report);
      const removed = Rubric.remove(rubric, id);
      expect(signed.assignment.report[id]).toBeDefined();
      expect(Rubric.has(removed, id)).toBe(false);
      expect(removed.assignment.report[id]).toBeUndefined();
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
      const assignee = 'student@example.com';
      const roster = [assignee];
      const rubric = await Rubric.assign(create(), assignee, roster);
      expect(rubric.assignment.assignee).toBe(assignee);
      expect(rubric.assignment.signature).toBeTruthy();
      await expect(validate(rubric)).resolves.not.toThrow();
    });

    it('fails validation if signature is tampered', async () => {
      const { validate } = Rubric.Assignment;
      const assignee = 'student@example.com';
      const hacker = 'hacker@example.com';
      const rubric = await Rubric.assign(create(), assignee, [assignee]);
      const assignment = { ...rubric.assignment, assignee: hacker };
      const tampered = { ...rubric, assignment };
      await expect(validate(tampered)).rejects.toThrow('match');
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
      const populate = (id: string, refId: string) => {
        const cell: Rubric.Cell = {
          id,
          is: 'comparable',
          points: 1,
          reference: [refId],
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
        const outputs = new Map([[id, [data({})]]]); // ref is missing from outputs
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
      expect(report['c1'].status).toBe('correct');
      expect(report['c2'].status).toBe('correct');
    });

    it('summarizes a report correctly', () => {
      const report: Rubric.Assignment.Report = {
        c1: { ...Rubric.Score.CORRECT, points: 5, possible: 5 },
        c2: { ...Rubric.Score.INCORRECT, points: 0, possible: 10 }
      };
      const summary = Rubric.Assignment.summary(report);
      expect(summary.points).toBe(5);
      expect(summary.possible).toBe(15);
      expect(summary.status).toBe('summary');
    });
  });
});
