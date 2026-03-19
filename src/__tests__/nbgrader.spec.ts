/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { classify, clean, Cellular, detect, strip } from '../correxit/nbgrader';

const cell = (
  id: string,
  cell_type: string,
  source: string,
  nbgrader?: Record<string, any>
): Cellular => ({
  id,
  cell_type,
  source,
  metadata: nbgrader ? { nbgrader } : {}
});

namespace Cell {
  export const answer = (id: string, source = '') => cell(id, 'code', source, {
    grade: false, grade_id: id, locked: false,
    schema_version: 3, solution: true
  });

  export const code = (id: string, points = 1, source = '') =>
    cell(id, 'code', source, {
      grade: true, grade_id: id, locked: false, points,
      schema_version: 3, solution: true
    });

  export const markdown = (id: string, points = 1, source = '') =>
    cell(id, 'markdown', source, {
      grade: true, grade_id: id, locked: false, points,
      schema_version: 3, solution: true
    });

  export const plain = (id: string, type = 'code') =>
    cell(id, type, '', undefined);

  export const readonly = (id: string) => cell(id, 'markdown', '', {
    grade: false, grade_id: id, locked: true,
    schema_version: 3, solution: false
  });

  export const task = (id: string, points = 1) => cell(id, 'markdown', '', {
    grade: false, grade_id: id, locked: false, points,
    schema_version: 3, solution: false, task: true
  });

  export const test = (id: string, points = 1) => cell(id, 'code', '', {
    grade: true, grade_id: id, locked: false, points,
    schema_version: 3, solution: false
  });
};

describe('nbgrader', () => {
  describe('detect', () => {
    it('returns true when any cell has grade metadata', () => {
      expect(detect([Cell.plain('a'), Cell.test('b')])).toBe(true);
    });

    it('returns true when any cell has solution metadata', () => {
      expect(detect([Cell.answer('a'), Cell.plain('b')])).toBe(true);
    });

    it('returns false for plain notebooks', () => {
      expect(detect([Cell.plain('a'), Cell.plain('b')])).toBe(false);
    });

    it('returns false for read-only-only notebooks', () => {
      expect(detect([Cell.readonly('a')])).toBe(false);
    });

    it('returns true for task-only notebooks', () => {
      expect(detect([Cell.task('a'), Cell.plain('b')])).toBe(true);
    });
  });

  describe('classify', () => {
    it('maps autograded answer + tests to correctable', () => {
      const cells = [
        Cell.answer('q1'),
        Cell.test('t1', 2),
        Cell.test('t2', 1)
      ];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'q1', is: 'correctable', points: 3,
        references: ['t1', 't2']
      });
      expect(result.references[0]).toHaveLength(2);
      expect(result.references[0][0]).toMatchObject({
        cell: 'q1', referent: 't1', points: 2, secret: true
      });
      expect(result.references[0][1]).toMatchObject({
        cell: 'q1', referent: 't2', points: 1, secret: true
      });
      expect(result.warnings).toHaveLength(0);
    });

    it('maps answer without tests to reviewable with warning', () => {
      const cells = [Cell.answer('q1')];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'q1', is: 'reviewable', points: 1
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('No test cells');
    });

    it('maps manually graded code cell to reviewable', () => {
      const cells = [Cell.code('m1', 5)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'm1', is: 'reviewable', points: 5, references: null
      });
    });

    it('maps manually graded markdown to reviewable', () => {
      const cells = [Cell.markdown('m1', 3)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'm1', is: 'reviewable', points: 3
      });
    });

    it('maps task cell to reviewable on next unmarked cell', () => {
      const cells = [
        Cell.task('task1', 4),
        Cell.plain('work1')
      ];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'work1', is: 'reviewable', points: 4
      });
    });

    it('infers task from grade+markdown without task field (v1/v2)', () => {
      const graded = cell('old_task', 'markdown', '', {
        grade: true, grade_id: 'old_task',
        locked: false, points: 2,
        schema_version: 1, solution: false
      });
      const cells = [graded, Cell.plain('work')];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'work', is: 'reviewable', points: 2
      });
    });

    it('warns on orphaned test cell', () => {
      const cells = [Cell.test('orphan', 3)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('no preceding answer');
    });

    it('ignores read-only and unmarked cells', () => {
      const cells = [Cell.readonly('r1'), Cell.plain('p1')];
      const result = classify(cells);
      expect(result.cells).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('handles consecutive answers correctly', () => {
      const cells = [
        Cell.answer('q1'),
        Cell.answer('q2'),
        Cell.test('t2', 1)
      ];
      const result = classify(cells);
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0]).toMatchObject({
        id: 'q1', is: 'reviewable'
      });
      expect(result.cells[1]).toMatchObject({
        id: 'q2', is: 'correctable', references: ['t2']
      });
    });

    it('does not break linkage on intervening markdown', () => {
      const cells = [
        Cell.answer('q1'),
        cell('md', 'markdown', 'Check your answer:', undefined),
        Cell.test('t1', 2)
      ];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'q1', is: 'correctable', references: ['t1']
      });
    });

    it('handles mixed assignment', () => {
      const cells = [
        cell('intro', 'markdown', '# Problem Set', undefined),
        Cell.answer('q1'),
        Cell.test('t1a', 1),
        Cell.test('t1b', 1),
        cell('q2_prompt', 'markdown', '## Part 2', undefined),
        Cell.code('q2', 2),
        Cell.markdown('q3', 1)
      ];
      const result = classify(cells);
      expect(result.cells).toHaveLength(3);
      expect(result.cells[0]).toMatchObject({
        id: 'q1', is: 'correctable', points: 2
      });
      expect(result.cells[1]).toMatchObject({
        id: 'q2', is: 'reviewable', points: 2
      });
      expect(result.cells[2]).toMatchObject({
        id: 'q3', is: 'reviewable', points: 1
      });
    });

    it('records source transformations for cells with solution markers', () => {
      const src = [
        'def f():',
        '    ### BEGIN SOLUTION',
        '    return 1',
        '    ### END SOLUTION'
      ].join('\n');
      const cells = [
        Cell.answer('q1', src), Cell.test('t1', 1)
      ];
      const result = classify(cells);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].id).toBe('q1');
      expect(result.sources[0].source).toBe('def f():\n    return 1');
    });

    it('warns and discards trailing task with no working cell', () => {
      const cells = [Cell.task('task1', 2)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('Trailing task'))).toBe(true);
    });

    it('flushes pending answer when a task appears', () => {
      const cells = [
        Cell.answer('q1'),
        Cell.task('task1', 2),
        Cell.plain('work1')
      ];
      const result = classify(cells);
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0]).toMatchObject({ id: 'q1', is: 'reviewable' });
      expect(result.cells[1]).toMatchObject({
        id: 'work1', is: 'reviewable', points: 2
      });
    });

    it('warns when task is followed by a graded cell', () => {
      const cells = [
        Cell.task('task1', 3),
        Cell.code('m1', 5)
      ];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'm1', is: 'reviewable', points: 5
      });
      const discarded = result.warnings.some(
        w => w.includes('points discarded')
      );
      expect(discarded).toBe(true);
    });

    it('handles zero-point cells', () => {
      const cells = [Cell.code('m1', 0)];
      const result = classify(cells);
      expect(result.cells[0].points).toBe(0);
    });

    it('recalibrates fractional test points to smallest integers', () => {
      const cells = [
        Cell.answer('q1'),
        Cell.test('t1', 0.5),
        Cell.test('t2', 0.5)
      ];
      const result = classify(cells);
      expect(result.cells[0]).toMatchObject({
        id: 'q1', is: 'correctable', points: 2,
        references: ['t1', 't2']
      });
      expect(result.references[0][0].points).toBe(1);
      expect(result.references[0][1].points).toBe(1);
    });

    it('recalibrates mixed fractional points preserving ratios', () => {
      const cells = [
        Cell.answer('q1'),
        Cell.test('t1', 0.5),
        Cell.test('t2', 1.5)
      ];
      const result = classify(cells);
      expect(result.cells[0].points).toBe(4);
      expect(result.references[0][0].points).toBe(1);
      expect(result.references[0][1].points).toBe(3);
    });

    it('leaves already-integer test points unchanged', () => {
      const cells = [
        Cell.answer('q1'),
        Cell.test('t1', 2),
        Cell.test('t2', 3)
      ];
      const result = classify(cells);
      expect(result.cells[0].points).toBe(5);
      expect(result.references[0][0].points).toBe(2);
      expect(result.references[0][1].points).toBe(3);
    });

    it('rounds fractional points on standalone reviewable cells', () => {
      const c = cell('m1', 'code', '', {
        grade: true, grade_id: 'm1', locked: false,
        points: 1.5, schema_version: 3, solution: true
      });
      const result = classify([c]);
      expect(result.cells[0].points).toBe(2);
    });

    it('treats negative points as zero', () => {
      const c = cell('neg', 'code', '', {
        grade: true, grade_id: 'neg', locked: false,
        points: -5, schema_version: 3, solution: true
      });
      const result = classify([c]);
      expect(result.cells[0].points).toBe(0);
    });

    it('records source transformations for manually graded cells', () => {
      const src = '### BEGIN SOLUTION\nmy answer\n### END SOLUTION';
      const cells = [Cell.code('m1', 2, src)];
      const result = classify(cells);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0]).toEqual({ id: 'm1', source: 'my answer' });
    });
  });

  describe('strip', () => {
    it('removes solution marker lines, keeps code', () => {
      const source = [
        'def f():',
        '    ### BEGIN SOLUTION',
        '    return 42',
        '    ### END SOLUTION'
      ].join('\n');
      expect(strip(source)).toBe('def f():\n    return 42');
    });

    it('handles multiple solution regions', () => {
      const source = [
        'a = 1',
        '### BEGIN SOLUTION',
        'b = 2',
        '### END SOLUTION',
        'c = 3',
        '### BEGIN SOLUTION',
        'd = 4',
        '### END SOLUTION'
      ].join('\n');
      expect(strip(source)).toBe('a = 1\nb = 2\nc = 3\nd = 4');
    });

    it('strips mark scheme regions entirely', () => {
      const source = [
        'Some task description',
        '=== BEGIN MARK SCHEME ===',
        'Award 1 point for X',
        'Award 1 point for Y',
        '=== END MARK SCHEME ==='
      ].join('\n');
      expect(strip(source)).toBe('Some task description');
    });

    it('returns source unchanged when no markers present', () => {
      const source = 'x = 1\ny = 2';
      expect(strip(source)).toBe(source);
    });

    it('handles mixed markers', () => {
      const source = [
        'def f():',
        '    ### BEGIN SOLUTION',
        '    return 1',
        '    ### END SOLUTION',
        '',
        '=== BEGIN MARK SCHEME ===',
        'grading notes',
        '=== END MARK SCHEME ==='
      ].join('\n');
      expect(strip(source)).toBe('def f():\n    return 1\n');
    });
  });

  describe('clean', () => {
    it('removes the nbgrader key', () => {
      const metadata = {
        nbgrader: { grade: true, solution: false },
        editable: true,
        other: 'value'
      };
      const cleaned = clean(metadata);
      expect(cleaned).toEqual({ editable: true, other: 'value' });
      expect('nbgrader' in cleaned).toBe(false);
    });

    it('returns unchanged metadata when no nbgrader key', () => {
      const metadata = { editable: true };
      expect(clean(metadata)).toEqual({ editable: true });
    });
  });
});

const FIXTURES = path.resolve(__dirname, 'fixtures', 'nbgrader');

/** Load a .ipynb fixture and normalize cells to Cellular[]. */
function load(name: string): Cellular[] {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
  const notebook = JSON.parse(raw);
  return notebook.cells.map((c: any, i: number): Cellular => {
    const source = Array.isArray(c.source) ? c.source.join('') : c.source;
    const id = c.id ?? c.metadata?.nbgrader?.grade_id ?? `cell-${i}`;
    return { id, cell_type: c.cell_type, source, metadata: c.metadata ?? {} };
  });
}

describe('nbgrader fixtures', () => {
  describe('detect', () => {
    it.each([
      'test.ipynb',
      'test-v1.ipynb',
      'test-v2.ipynb',
      'test-hidden-tests.ipynb',
      'test-with-output.ipynb',
      'ps1-problem1.ipynb',
      'ps1-problem2.ipynb',
      'ps1-autotest-problem1.ipynb',
      'ps1-autotest-problem2.ipynb',
      'validation-zero-points.ipynb',
    ])('%s is detected as nbgrader', (name) => {
      expect(detect(load(name))).toBe(true);
    });
  });

  describe('test.ipynb (canonical v3)', () => {
    const result = classify(load('test.ipynb'));

    it('produces 4 rubric cells', () => {
      expect(result.cells).toHaveLength(4);
    });

    it('maps squares to correctable with 2 test refs', () => {
      const q = result.cells[0];
      expect(q).toMatchObject({
        is: 'correctable',
        points: 2,
        references: expect.arrayContaining([
          expect.stringContaining('correct_squares'),
          expect.stringContaining('squares_invalid_input'),
        ])
      });
    });

    it('maps sum_of_squares to correctable (recalibrated from 0.5+0.5)', () => {
      const q = result.cells[1];
      expect(q).toMatchObject({
        is: 'correctable',
        points: 2
      });
      const refs = result.references[1];
      expect(refs[0].points).toBe(1);
      expect(refs[1].points).toBe(1);
    });

    it('maps manual markdown to reviewable', () => {
      expect(result.cells[2]).toMatchObject({
        is: 'reviewable', points: 1
      });
    });

    it('maps manual code to reviewable', () => {
      expect(result.cells[3]).toMatchObject({
        is: 'reviewable', points: 2
      });
    });

    it('has no warnings', () => {
      expect(result.warnings).toHaveLength(0);
    });

    it('strips solution markers from answer cells', () => {
      expect(result.sources.length).toBeGreaterThan(0);
      for (const s of result.sources) {
        expect(s.source).not.toContain('BEGIN SOLUTION');
        expect(s.source).not.toContain('END SOLUTION');
      }
    });

    it('creates secret references for all test cells', () => {
      const refs = result.references.flat();
      for (const ref of refs) {
        expect(ref.secret).toBe(true);
      }
    });
  });

  describe('test-v1.ipynb (schema v1)', () => {
    const result = classify(load('test-v1.ipynb'));

    it('produces same structure as v3', () => {
      expect(result.cells).toHaveLength(4);
      expect(result.cells[0].is).toBe('correctable');
      expect(result.cells[1].is).toBe('correctable');
      expect(result.cells[2].is).toBe('reviewable');
      expect(result.cells[3].is).toBe('reviewable');
    });

    it('has no warnings', () => {
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('test-v2.ipynb (schema v2)', () => {
    const result = classify(load('test-v2.ipynb'));

    it('produces same structure as v3', () => {
      expect(result.cells).toHaveLength(4);
      expect(result.cells.map(c => c.is)).toEqual([
        'correctable', 'correctable', 'reviewable', 'reviewable'
      ]);
    });
  });

  describe('test-hidden-tests.ipynb', () => {
    const result = classify(load('test-hidden-tests.ipynb'));

    it('classifies both answers as correctable', () => {
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0].is).toBe('correctable');
      expect(result.cells[1].is).toBe('correctable');
    });

    it('captures hidden test references', () => {
      const refs = result.references.flat();
      expect(refs.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('ps1-problem1.ipynb (docs example)', () => {
    const result = classify(load('ps1-problem1.ipynb'));

    it('has correctable, reviewable, and task cells', () => {
      const types = result.cells.map(c => c.is);
      expect(types).toContain('correctable');
      expect(types).toContain('reviewable');
    });

    it('produces 4 rubric entries', () => {
      expect(result.cells).toHaveLength(4);
    });

    it('strips solution markers', () => {
      for (const s of result.sources) {
        expect(s.source).not.toContain('BEGIN SOLUTION');
      }
    });
  });

  describe('ps1-autotest-problem1.ipynb', () => {
    const result = classify(
      load('ps1-autotest-problem1.ipynb')
    );

    it('handles task cell with following unmarked cell', () => {
      const target = result.cells.find(
        c => c.points === 4
      );
      expect(target).toBeDefined();
      expect(target!.is).toBe('reviewable');
    });

    it('handles zero-point test cells', () => {
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('ps1-problem2.ipynb (manual only)', () => {
    const result = classify(load('ps1-problem2.ipynb'));

    it('maps both cells as reviewable', () => {
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0].is).toBe('reviewable');
      expect(result.cells[1].is).toBe('reviewable');
    });

    it('totals 3 points', () => {
      const total = result.cells.reduce(
        (sum, c) => sum + c.points, 0
      );
      expect(total).toBe(3);
    });
  });

  describe('integer points invariant', () => {
    it.each([
      'test.ipynb',
      'test-v1.ipynb',
      'test-v2.ipynb',
      'test-hidden-tests.ipynb',
      'test-with-output.ipynb',
      'ps1-problem1.ipynb',
      'ps1-problem2.ipynb',
      'ps1-autotest-problem1.ipynb',
      'ps1-autotest-problem2.ipynb',
      'validation-zero-points.ipynb',
    ])('%s produces only integer points', (name) => {
      const result = classify(load(name));
      for (const c of result.cells)
        expect(Number.isInteger(c.points)).toBe(true);
      for (const refs of result.references)
        for (const ref of refs)
          expect(Number.isInteger(ref.points)).toBe(true);
    });
  });

  describe('validation-zero-points.ipynb', () => {
    const result = classify(
      load('validation-zero-points.ipynb')
    );

    it('maps zero-point test as correctable', () => {
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0].is).toBe('correctable');
      expect(result.cells[0].points).toBe(0);
    });
  });
});
