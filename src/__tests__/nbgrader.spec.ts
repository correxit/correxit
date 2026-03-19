/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import * as nbgrader from '../correxit/nbgrader';

type Cellular = nbgrader.Cellular;
type Executor = nbgrader.Executor;

const { autotests, classify, clean, detect, spread: expand, strip } = nbgrader;

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
  export const answer = (id: string, source = '') =>
    cell(id, 'code', source, {
      grade: false,
      grade_id: id,
      locked: false,
      schema_version: 3,
      solution: true
    });

  export const code = (id: string, points = 1, source = '') =>
    cell(id, 'code', source, {
      grade: true,
      grade_id: id,
      locked: false,
      points,
      schema_version: 3,
      solution: true
    });

  export const markdown = (id: string, points = 1, source = '') =>
    cell(id, 'markdown', source, {
      grade: true,
      grade_id: id,
      locked: false,
      points,
      schema_version: 3,
      solution: true
    });

  export const plain = (id: string, type = 'code') =>
    cell(id, type, '', undefined);

  export const readonly = (id: string) =>
    cell(id, 'markdown', '', {
      grade: false,
      grade_id: id,
      locked: true,
      schema_version: 3,
      solution: false
    });

  export const task = (id: string, points = 1) =>
    cell(id, 'markdown', '', {
      grade: false,
      grade_id: id,
      locked: false,
      points,
      schema_version: 3,
      solution: false,
      task: true
    });

  export const test = (id: string, points = 1) =>
    cell(id, 'code', '', {
      grade: true,
      grade_id: id,
      locked: false,
      points,
      schema_version: 3,
      solution: false
    });
}

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
      const cells = [Cell.answer('q1'), Cell.test('t1', 2), Cell.test('t2', 1)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'q1',
        is: 'correctable',
        points: 3,
        references: ['t1', 't2']
      });
      expect(result.references[0]).toHaveLength(2);
      expect(result.references[0][0]).toMatchObject({
        cell: 'q1',
        referent: 't1',
        points: 2,
        secret: true
      });
      expect(result.references[0][1]).toMatchObject({
        cell: 'q1',
        referent: 't2',
        points: 1,
        secret: true
      });
      expect(result.warnings).toHaveLength(0);
    });

    it('maps answer without tests to reviewable with warning', () => {
      const cells = [Cell.answer('q1')];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'q1',
        is: 'reviewable',
        points: 1
      });
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('No test cells');
    });

    it('maps manually graded code cell to reviewable', () => {
      const cells = [Cell.code('m1', 5)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'm1',
        is: 'reviewable',
        points: 5,
        references: null
      });
    });

    it('maps manually graded markdown to reviewable', () => {
      const cells = [Cell.markdown('m1', 3)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'm1',
        is: 'reviewable',
        points: 3
      });
    });

    it('maps task cell to reviewable on next unmarked cell', () => {
      const cells = [Cell.task('task1', 4), Cell.plain('work1')];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'work1',
        is: 'reviewable',
        points: 4
      });
    });

    it('infers task from grade+markdown without task field (v1/v2)', () => {
      const graded = cell('old_task', 'markdown', '', {
        grade: true,
        grade_id: 'old_task',
        locked: false,
        points: 2,
        schema_version: 1,
        solution: false
      });
      const cells = [graded, Cell.plain('work')];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'work',
        is: 'reviewable',
        points: 2
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
      const cells = [Cell.answer('q1'), Cell.answer('q2'), Cell.test('t2', 1)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0]).toMatchObject({
        id: 'q1',
        is: 'reviewable'
      });
      expect(result.cells[1]).toMatchObject({
        id: 'q2',
        is: 'correctable',
        references: ['t2']
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
        id: 'q1',
        is: 'correctable',
        references: ['t1']
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
        id: 'q1',
        is: 'correctable',
        points: 2
      });
      expect(result.cells[1]).toMatchObject({
        id: 'q2',
        is: 'reviewable',
        points: 2
      });
      expect(result.cells[2]).toMatchObject({
        id: 'q3',
        is: 'reviewable',
        points: 1
      });
    });

    it('records source transformations for cells with solution markers', () => {
      const source = [
        'def f():',
        '    ### BEGIN SOLUTION',
        '    return 1',
        '    ### END SOLUTION'
      ].join('\n');
      const cells = [Cell.answer('q1', source), Cell.test('t1', 1)];
      const result = classify(cells);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].id).toBe('q1');
      expect(result.sources[0].source).toBe('def f():\n    return 1');
    });

    it('warns and discards trailing task with no working cell', () => {
      const cells = [Cell.task('task1', 2)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(0);
      const trailing = result.warnings.some(warning =>
        warning.includes('Trailing task')
      );
      expect(trailing).toBe(true);
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
        id: 'work1',
        is: 'reviewable',
        points: 2
      });
    });

    it('warns when task is followed by a graded cell', () => {
      const cells = [Cell.task('task1', 3), Cell.code('m1', 5)];
      const result = classify(cells);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]).toMatchObject({
        id: 'm1',
        is: 'reviewable',
        points: 5
      });
      const discarded = result.warnings.some(warning =>
        warning.includes('points discarded')
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
        id: 'q1',
        is: 'correctable',
        points: 2,
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
      const cells = [Cell.answer('q1'), Cell.test('t1', 2), Cell.test('t2', 3)];
      const result = classify(cells);
      expect(result.cells[0].points).toBe(5);
      expect(result.references[0][0].points).toBe(2);
      expect(result.references[0][1].points).toBe(3);
    });

    it('rounds fractional points on standalone reviewable cells', () => {
      const manual = cell('m1', 'code', '', {
        grade: true,
        grade_id: 'm1',
        locked: false,
        points: 1.5,
        schema_version: 3,
        solution: true
      });
      const result = classify([manual]);
      expect(result.cells[0].points).toBe(2);
    });

    it('treats negative points as zero', () => {
      const negative = cell('neg', 'code', '', {
        grade: true,
        grade_id: 'neg',
        locked: false,
        points: -5,
        schema_version: 3,
        solution: true
      });
      const result = classify([negative]);
      expect(result.cells[0].points).toBe(0);
    });

    it('records source transformations for manually graded cells', () => {
      const source = '### BEGIN SOLUTION\nmy answer\n### END SOLUTION';
      const cells = [Cell.code('m1', 2, source)];
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

  describe('autotests', () => {
    it('detects ### AUTOTEST directives', () => {
      expect(autotests('### AUTOTEST squares(1)')).toBe(true);
    });

    it('detects ### HASHED AUTOTEST directives', () => {
      expect(autotests('### HASHED AUTOTEST squares(3)')).toBe(true);
    });

    it('returns false for plain code', () => {
      expect(autotests('assert squares(1) == [1]')).toBe(false);
    });

    it('returns false for solution markers', () => {
      expect(autotests('### BEGIN SOLUTION\n### END SOLUTION')).toBe(false);
    });

    it('detects autotests among other lines', () => {
      const source = '"""docstring"""\n### AUTOTEST f(1); f(2)\nassert True';
      expect(autotests(source)).toBe(true);
    });
  });

  describe('expand', () => {
    const answer = (id: string, source: string): Cellular => ({
      id,
      cell_type: 'code',
      source,
      metadata: {
        nbgrader: {
          grade: false,
          grade_id: id,
          locked: false,
          schema_version: 3,
          solution: true
        }
      }
    });

    const test_cell = (
      id: string,
      points: number,
      source: string
    ): Cellular => ({
      id,
      cell_type: 'code',
      source,
      metadata: {
        nbgrader: {
          grade: true,
          grade_id: id,
          locked: false,
          points,
          schema_version: 3,
          solution: false
        }
      }
    });

    it('expands autotest directives using executor results', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x * 2'),
        test_cell('t1', 1, '### AUTOTEST f(1)')
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        if (code === 'f(1)') return '2';
        return null;
      };
      const result = await expand(cells, classification, executor);

      const source = result.sources.find(s => s.id === 't1');
      expect(source).toBeDefined();
      expect(source!.source).toBe('assert f(1) == 2');
    });

    it('expands semicolon-separated expressions', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x'),
        test_cell('t1', 1, '### AUTOTEST f(1); f(2)')
      ];
      const classification = classify(cells);
      const values: Record<string, string> = { 'f(1)': '1', 'f(2)': '2' };
      const executor: Executor = async code => values[code] ?? null;
      const result = await expand(cells, classification, executor);

      const source = result.sources.find(s => s.id === 't1');
      expect(source!.source).toBe('assert f(1) == 1\nassert f(2) == 2');
    });

    it('preserves non-autotest code around directives', async () => {
      const source = [
        '"""docstring"""',
        'x = 1',
        '### AUTOTEST f(x)',
        'x = 2'
      ].join('\n');
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x'),
        test_cell('t1', 1, source)
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        if (code === 'f(x)') return '1';
        return null;
      };
      const result = await expand(cells, classification, executor);

      const expanded = result.sources.find(s => s.id === 't1');
      expect(expanded!.source).toBe(
        '"""docstring"""\nx = 1\nassert f(x) == 1\nx = 2'
      );
    });

    it('adds warning when expression evaluation fails', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x'),
        test_cell('t1', 1, '### AUTOTEST f(bad)')
      ];
      const classification = classify(cells);
      const executor: Executor = async () => null;
      const result = await expand(cells, classification, executor);

      expect(result.warnings).toContain(
        'Expansion failed for "f(bad)" in cell "t1"'
      );
    });

    it('does not add source entry when all expressions fail', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x'),
        test_cell('t1', 1, '### AUTOTEST bad()')
      ];
      const classification = classify(cells);
      const executor: Executor = async () => null;
      const result = await expand(cells, classification, executor);

      expect(result.sources.find(s => s.id === 't1')).toBeUndefined();
    });

    it('executes answer cells before test cells', async () => {
      const executed: string[] = [];
      const cells: Cellular[] = [
        answer('a1', 'def f(): return 42'),
        test_cell('t1', 1, '### AUTOTEST f()')
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        executed.push(code);
        if (code === 'f()') return '42';
        return null;
      };
      await expand(cells, classification, executor);

      expect(executed[0]).toBe('def f(): return 42');
      expect(executed[1]).toBe('f()');
    });

    it('handles HASHED AUTOTEST the same as AUTOTEST', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x ** 2'),
        test_cell('t1', 1, '### HASHED AUTOTEST f(3)')
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        if (code === 'f(3)') return '9';
        return null;
      };
      const result = await expand(cells, classification, executor);

      const source = result.sources.find(s => s.id === 't1');
      expect(source!.source).toBe('assert f(3) == 9');
    });

    it('executes non-autotest test cells for side effects', async () => {
      const executed: string[] = [];
      const cells: Cellular[] = [
        answer('a1', 'def f(): return 1'),
        test_cell('t1', 1, 'helper = lambda: True'),
        test_cell('t2', 1, '### AUTOTEST f()')
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        executed.push(code);
        if (code === 'f()') return '1';
        return null;
      };
      await expand(cells, classification, executor);

      expect(executed).toContain('helper = lambda: True');
    });

    it('preserves existing sources from classification', async () => {
      const cells: Cellular[] = [
        answer('a1', '### BEGIN SOLUTION\ndef f(): return 1\n### END SOLUTION'),
        test_cell('t1', 1, '### AUTOTEST f()')
      ];
      const classification = classify(cells);
      expect(classification.sources).toHaveLength(1);
      expect(classification.sources[0].id).toBe('a1');

      const executor: Executor = async code => {
        if (code === 'f()') return '1';
        return null;
      };
      const result = await expand(cells, classification, executor);

      expect(result.sources.find(s => s.id === 'a1')).toBeDefined();
      expect(result.sources.find(s => s.id === 't1')).toBeDefined();
    });
  });
});

const FIXTURES = path.resolve(__dirname, 'fixtures', 'nbgrader');

/** Load a .ipynb fixture and normalize cells to Cellular[]. */
function load(name: string): Cellular[] {
  const raw = fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
  const notebook = JSON.parse(raw);
  return notebook.cells.map((cell: any, i: number): Cellular => {
    const { cell_type, metadata = {} } = cell;
    const source = Array.isArray(cell.source)
      ? cell.source.join('')
      : cell.source;
    const id = cell.id ?? metadata?.nbgrader?.grade_id ?? `cell-${i}`;
    return { id, cell_type, source, metadata };
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
      'validation-zero-points.ipynb'
    ])('%s is detected as nbgrader', name => {
      expect(detect(load(name))).toBe(true);
    });
  });

  describe('test.ipynb (canonical v3)', () => {
    const result = classify(load('test.ipynb'));

    it('produces 4 rubric cells', () => {
      expect(result.cells).toHaveLength(4);
    });

    it('maps squares to correctable with 2 test refs', () => {
      expect(result.cells[0]).toMatchObject({
        is: 'correctable',
        points: 2,
        references: expect.arrayContaining([
          expect.stringContaining('correct_squares'),
          expect.stringContaining('squares_invalid_input')
        ])
      });
    });

    it('maps sum_of_squares to correctable (recalibrated from 0.5+0.5)', () => {
      expect(result.cells[1]).toMatchObject({
        is: 'correctable',
        points: 2
      });
      const references = result.references[1];
      expect(references[0].points).toBe(1);
      expect(references[1].points).toBe(1);
    });

    it('maps manual markdown to reviewable', () => {
      expect(result.cells[2]).toMatchObject({
        is: 'reviewable',
        points: 1
      });
    });

    it('maps manual code to reviewable', () => {
      expect(result.cells[3]).toMatchObject({
        is: 'reviewable',
        points: 2
      });
    });

    it('has no warnings', () => {
      expect(result.warnings).toHaveLength(0);
    });

    it('strips solution markers from answer cells', () => {
      expect(result.sources.length).toBeGreaterThan(0);
      for (const { source } of result.sources) {
        expect(source).not.toContain('BEGIN SOLUTION');
        expect(source).not.toContain('END SOLUTION');
      }
    });

    it('creates secret references for all test cells', () => {
      const references = result.references.flat();
      for (const reference of references) {
        expect(reference.secret).toBe(true);
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
      expect(result.cells.map(cell => cell.is)).toEqual([
        'correctable',
        'correctable',
        'reviewable',
        'reviewable'
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
      const references = result.references.flat();
      expect(references.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('ps1-problem1.ipynb (docs example)', () => {
    const result = classify(load('ps1-problem1.ipynb'));

    it('has correctable, reviewable, and task cells', () => {
      const types = result.cells.map(cell => cell.is);
      expect(types).toContain('correctable');
      expect(types).toContain('reviewable');
    });

    it('produces 4 rubric entries', () => {
      expect(result.cells).toHaveLength(4);
    });

    it('strips solution markers', () => {
      for (const { source } of result.sources) {
        expect(source).not.toContain('BEGIN SOLUTION');
      }
    });
  });

  describe('ps1-autotest-problem1.ipynb', () => {
    const result = classify(load('ps1-autotest-problem1.ipynb'));

    it('handles task cell with following unmarked cell', () => {
      const target = result.cells.find(cell => cell.points === 4);
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
      const total = result.cells.reduce((sum, cell) => sum + cell.points, 0);
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
      'validation-zero-points.ipynb'
    ])('%s produces only integer points', name => {
      const result = classify(load(name));
      for (const cell of result.cells)
        expect(Number.isInteger(cell.points)).toBe(true);
      for (const references of result.references)
        for (const reference of references)
          expect(Number.isInteger(reference.points)).toBe(true);
    });
  });

  describe('validation-zero-points.ipynb', () => {
    const result = classify(load('validation-zero-points.ipynb'));

    it('maps zero-point test as correctable', () => {
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0].is).toBe('correctable');
      expect(result.cells[0].points).toBe(0);
    });
  });
});
