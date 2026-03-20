/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../correxit/workbook', () => ({ Workbook: {} }));

import * as nbgrader from '../correxit/nbgrader';

type Cellular = nbgrader.Cellular;
type Executor = nbgrader.Executor;

const {
  autotests,
  classify,
  clean,
  detect,
  hidden,
  presplit,
  slippage,
  spread: expand,
  strip
} = nbgrader;

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

/** Run the full presplit + classify pipeline (mirrors convert). */
function pipeline(raw: Cellular[]) {
  const split = presplit(raw);
  const result = classify(split.cells);
  return {
    ...result,
    sources: [...split.sources, ...result.sources],
    splits: split.splits
  };
}

const support = [
  'def __correxit_autotest__(label, actual, expected):',
  '    if actual != expected:',
  '        raise AssertionError(',
  '            f"{label}: expected {expected!r}, got {actual!r}"',
  '        )'
].join('\n');

const invoke = (expr: string, value: string): string =>
  [
    '__correxit_autotest__(',
    `  ${JSON.stringify(expr)},`,
    `  (${expr}),`,
    `  ${value}`,
    ')'
  ].join('\n');

const script = (...pairs: [string, string][]): string =>
  [
    support,
    '',
    ...pairs.map(([expr, value]) => invoke(expr, value)),
    '',
    'print("Success!")'
  ].join('\n');

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

    it('splits test cell with hidden markers into reference', () => {
      const source = [
        'assert f(1) == 1',
        '### BEGIN HIDDEN TESTS',
        'assert f(10) == 100',
        '### END HIDDEN TESTS'
      ].join('\n');
      const test = cell('t1', 'code', source, {
        grade: true,
        grade_id: 't1',
        locked: false,
        points: 2,
        schema_version: 3,
        solution: false
      });
      const cells = [Cell.answer('q1'), test];
      const result = pipeline(cells);

      expect(result.cells[0]).toMatchObject({
        id: 'q1',
        is: 'correctable',
        references: ['t1', 't1-hidden']
      });
      expect(result.references[0]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            cell: 'q1',
            referent: 't1',
            points: 2,
            secret: true
          }),
          expect.objectContaining({
            cell: 'q1',
            referent: 't1-hidden',
            points: 2,
            secret: true
          })
        ])
      );
      expect(result.splits).toHaveLength(1);
      expect(result.splits[0]).toEqual({
        cell: 't1',
        referent: 't1-hidden',
        source: 'assert f(10) == 100'
      });
      const visible = result.sources.find(s => s.id === 't1');
      expect(visible).toBeDefined();
      expect(visible!.source).toBe('assert f(1) == 1');
    });

    it('does not split when visible portion is empty', () => {
      const source = [
        '### BEGIN HIDDEN TESTS',
        'assert f(10) == 100',
        '### END HIDDEN TESTS'
      ].join('\n');
      const test = cell('t1', 'code', source, {
        grade: true,
        grade_id: 't1',
        locked: false,
        points: 2,
        schema_version: 3,
        solution: false
      });
      const cells = [Cell.answer('q1'), test];
      const result = pipeline(cells);
      expect(result.cells[0].references).toEqual(['t1']);
      expect(result.splits).toHaveLength(0);
    });

    it('splits hidden tests alongside regular tests', () => {
      const source = [
        'assert f(1) == 1',
        '### BEGIN HIDDEN TESTS',
        'assert f(10) == 100',
        '### END HIDDEN TESTS'
      ].join('\n');
      const cells = [
        Cell.answer('q1'),
        cell('t1', 'code', source, {
          grade: true,
          grade_id: 't1',
          locked: false,
          points: 1,
          schema_version: 3,
          solution: false
        }),
        Cell.test('t2', 1)
      ];
      const result = pipeline(cells);
      expect(result.cells[0]).toMatchObject({
        is: 'correctable',
        references: ['t1', 't1-hidden', 't2']
      });
      expect(result.splits).toHaveLength(1);
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

  describe('hidden', () => {
    it('extracts hidden region and returns visible remainder', () => {
      const source = [
        'assert f(1) == 1',
        '### BEGIN HIDDEN TESTS',
        'assert f(10) == 100',
        '### END HIDDEN TESTS'
      ].join('\n');
      const result = hidden(source)!;
      expect(result.visible).toBe('assert f(1) == 1');
      expect(result.hidden).toBe('assert f(10) == 100');
    });

    it('handles multiple hidden regions', () => {
      const source = [
        'assert f(1) == 1',
        '### BEGIN HIDDEN TESTS',
        'assert f(2) == 4',
        '### END HIDDEN TESTS',
        'assert f(3) == 9',
        '### BEGIN HIDDEN TESTS',
        'assert f(4) == 16',
        '### END HIDDEN TESTS'
      ].join('\n');
      const result = hidden(source)!;
      expect(result.visible).toBe('assert f(1) == 1\nassert f(3) == 9');
      expect(result.hidden).toBe('assert f(2) == 4\nassert f(4) == 16');
    });

    it('returns null when no markers present', () => {
      expect(hidden('assert f(1) == 1')).toBeNull();
    });

    it('trims trailing whitespace from visible portion', () => {
      const source = [
        'assert f(1) == 1',
        '',
        '### BEGIN HIDDEN TESTS',
        'assert f(10) == 100',
        '### END HIDDEN TESTS'
      ].join('\n');
      const result = hidden(source)!;
      expect(result.visible).toBe('assert f(1) == 1');
    });

    it('supports singular HIDDEN TEST marker', () => {
      const source = [
        'visible',
        '### BEGIN HIDDEN TEST',
        'secret',
        '### END HIDDEN TEST'
      ].join('\n');
      const result = hidden(source)!;
      expect(result.visible).toBe('visible');
      expect(result.hidden).toBe('secret');
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

    const check = (id: string, points: number, source: string): Cellular => ({
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
        check('t1', 1, '### AUTOTEST f(1)')
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        if (code === 'f(1)') return '2';
        return null;
      };
      const result = await expand(cells, classification, executor);
      const source = result.sources.find(s => s.id === 't1');
      expect(source).toBeDefined();
      expect(source!.source).toBe(script(['f(1)', '2']));
    });

    it('expands semicolon-separated expressions', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x'),
        check('t1', 1, '### AUTOTEST f(1); f(2)')
      ];
      const classification = classify(cells);
      const values: Record<string, string> = { 'f(1)': '1', 'f(2)': '2' };
      const executor: Executor = async code => values[code] ?? null;
      const result = await expand(cells, classification, executor);
      const source = result.sources.find(s => s.id === 't1');
      expect(source!.source).toBe(script(['f(1)', '1'], ['f(2)', '2']));
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
        check('t1', 1, source)
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        if (code === 'f(x)') return '1';
        return null;
      };
      const result = await expand(cells, classification, executor);
      const expanded = result.sources.find(s => s.id === 't1');
      expect(expanded!.source).toBe(
        [
          '"""docstring"""',
          'x = 1',
          support,
          '',
          invoke('f(x)', '1'),
          'x = 2',
          '',
          'print("Success!")'
        ].join('\n')
      );
    });

    it('adds warning when expression evaluation fails', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x'),
        check('t1', 1, '### AUTOTEST f(bad)')
      ];
      const classification = classify(cells);
      const executor: Executor = async () => null;
      const result = await expand(cells, classification, executor);
      expect(result.warnings).toContain(
        'Expansion failed for "f(bad)" in cell "t1"'
      );
      const source = result.sources.find(s => s.id === 't1');
      expect(source).toBeDefined();
      expect(source!.source).toContain(
        '# Correxit could not safely convert this AUTOTEST.'
      );
    });

    it('adds a placeholder when all expressions fail', async () => {
      const cells: Cellular[] = [
        answer('a1', 'def f(x): return x'),
        check('t1', 1, '### AUTOTEST bad()')
      ];
      const classification = classify(cells);
      const executor: Executor = async () => null;
      const result = await expand(cells, classification, executor);
      const source = result.sources.find(s => s.id === 't1');
      expect(source).toBeDefined();
      expect(source!.source).toContain('raise NotImplementedError');
    });

    it('adds a placeholder when an assertion is unsafe', async () => {
      const cells: Cellular[] = [
        answer('a1', 'a = 5'),
        check('t1', 1, '### AUTOTEST type(a)')
      ];
      const classification = classify(cells);
      const executor: Executor = async code =>
        code === 'type(a)' ? 'int' : null;
      const resolver = async () => ({ safe: false, value: 'int' });
      const result = await expand(cells, classification, executor, resolver);

      expect(result.warnings).toContain(
        'Could not safely convert AUTOTEST "type(a)" in cell "t1"'
      );
      const source = result.sources.find(s => s.id === 't1');
      expect(source).toBeDefined();
      expect(source!.source).toContain('# Observed kernel value:');
      expect(source!.source).toContain('# int');
      expect(source!.source).toContain('raise NotImplementedError');
    });

    it('executes answer cells before test cells', async () => {
      const executed: string[] = [];
      const cells: Cellular[] = [
        answer('a1', 'def f(): return 42'),
        check('t1', 1, '### AUTOTEST f()')
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
        check('t1', 1, '### HASHED AUTOTEST f(3)')
      ];
      const classification = classify(cells);
      const executor: Executor = async code => {
        if (code === 'f(3)') return '9';
        return null;
      };
      const result = await expand(cells, classification, executor);
      const source = result.sources.find(s => s.id === 't1');
      expect(source!.source).toBe(script(['f(3)', '9']));
    });

    it('executes non-autotest test cells for side effects', async () => {
      const executed: string[] = [];
      const cells: Cellular[] = [
        answer('a1', 'def f(): return 1'),
        check('t1', 1, 'helper = lambda: True'),
        check('t2', 1, '### AUTOTEST f()')
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
        check('t1', 1, '### AUTOTEST f()')
      ];
      const classification = classify(cells);
      expect(classification.sources).toHaveLength(1);
      expect(classification.sources[0].id).toBe('a1');

      const executor: Executor = async code => {
        if (code === 'f()') return '1';
        return null;
      };
      const result = await expand(cells, classification, executor);
      expect(result.sources.find(({ id }) => id === 'a1')).toBeDefined();
      expect(result.sources.find(({ id }) => id === 't1')).toBeDefined();
    });

    it('expands directives in hidden and visible portions of split cells', async () => {
      const raw: Cellular[] = [
        answer('a1', 'a = 5'),
        check(
          't1',
          1,
          [
            '### BEGIN HIDDEN TESTS',
            '### AUTOTEST a',
            '### END HIDDEN TESTS',
            '',
            '### AUTOTEST type(a)'
          ].join('\n')
        )
      ];
      const split = presplit(raw);
      const draft = classify(split.cells);
      const classification = {
        ...draft,
        sources: [...split.sources, ...draft.sources],
        splits: split.splits
      };
      expect(classification.splits).toHaveLength(1);

      const values: Record<string, string> = {
        a: '5',
        'type(a)': 'int'
      };
      const executor: Executor = async code => values[code] ?? null;
      const result = await expand(split.cells, classification, executor);

      // Visible portion expanded (leading blank line from hidden split).
      const visible = result.sources.find(s => s.id === 't1');
      expect(visible).toBeDefined();
      expect(visible!.source).toBe(`\n${script(['type(a)', 'int'])}`);

      // Hidden portion expanded (now in sources under the referent ID).
      const secret = result.sources.find(s => s.id === 't1-hidden');
      expect(secret).toBeDefined();
      expect(secret!.source).toBe(script(['a', '5']));
    });
  });

  describe('slippage', () => {
    it('returns null when no cells carry metadata points', () => {
      const cells = [Cell.answer('a1'), Cell.test('t1', 2)];
      const classification = classify(cells);
      // answer has no points in metadata (solution-only), test has 2;
      // rubric total is 2, metadata total is 2 → null
      expect(slippage(cells, classification)).toBeNull();
    });

    it('returns null when metadata points match rubric points', () => {
      const cells = [Cell.answer('a1'), Cell.test('t1', 3), Cell.test('t2', 2)];
      const classification = classify(cells);
      // metadata: 3 + 2 = 5, rubric: 3 + 2 = 5
      expect(slippage(cells, classification)).toBeNull();
    });

    it('detects slippage from fractional recalibration', () => {
      const cells = [
        Cell.answer('a1'),
        Cell.test('t1', 0.5),
        Cell.test('t2', 0.5)
      ];
      const classification = classify(cells);
      // metadata: 0.5 + 0.5 = 1, rubric after recalibrate: 1 + 1 = 2
      expect(slippage(cells, classification)).toBe(1);
    });

    it('detects slippage from discarded task points', () => {
      // Trailing task with no following unmarked cell: points discarded.
      const cells = [Cell.task('t1', 5)];
      const classification = classify(cells);
      // metadata: 5, rubric: 0 (task discarded)
      expect(slippage(cells, classification)).toBe(5);
    });

    it('detects slippage from orphan answer losing its points', () => {
      // Autograded answer with no test cells → forced to 1-point reviewable.
      const cells = [Cell.answer('a1')];
      const classification = classify(cells);
      // answer metadata has no points field → not counted in metadata total.
      // rubric: 1 (default reviewable). No metadata points → null.
      expect(slippage(cells, classification)).toBeNull();
    });

    it('ignores cells without grade, solution, or task flags', () => {
      const cells = [
        Cell.readonly('r1'),
        Cell.answer('a1'),
        Cell.test('t1', 2)
      ];
      const classification = classify(cells);
      // readonly has locked=true but no grade/solution/task → ignored
      expect(slippage(cells, classification)).toBeNull();
    });

    it('clamps negative metadata points to zero', () => {
      const cells = [
        Cell.answer('a1'),
        cell('t1', 'code', '', {
          grade: true,
          grade_id: 't1',
          locked: false,
          points: -3,
          schema_version: 3,
          solution: false
        })
      ];
      const classification = classify(cells);
      // metadata: max(0, -3) = 0, rubric: 0 (test with 0 points)
      expect(slippage(cells, classification)).toBeNull();
    });

    it('detects slippage from rounding on manual cells', () => {
      const cells = [
        cell('m1', 'code', '', {
          grade: true,
          grade_id: 'm1',
          locked: false,
          points: 1.7,
          schema_version: 3,
          solution: true
        })
      ];
      const classification = classify(cells);
      // metadata: 1.7, rubric: Math.round(1.7) = 2
      expect(slippage(cells, classification)).toBe(1.7);
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
      expect(result.cells[1]).toMatchObject({ is: 'correctable', points: 2 });

      const references = result.references[1];
      expect(references[0].points).toBe(1);
      expect(references[1].points).toBe(1);
    });

    it('maps manual markdown to reviewable', () => {
      expect(result.cells[2]).toMatchObject({ is: 'reviewable', points: 1 });
    });

    it('maps manual code to reviewable', () => {
      expect(result.cells[3]).toMatchObject({ is: 'reviewable', points: 2 });
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
      for (const reference of references) expect(reference.secret).toBe(true);
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
    const result = pipeline(load('test-hidden-tests.ipynb'));

    it('classifies both answers as correctable', () => {
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0].is).toBe('correctable');
      expect(result.cells[1].is).toBe('correctable');
    });

    it('each correctable has 3 references: visible + hidden + regular', () => {
      for (const cell of result.cells) {
        expect(cell.references).toHaveLength(3);
        expect(
          cell.references!.filter(id => id.endsWith('-hidden'))
        ).toHaveLength(1);
      }
      const flat = result.references.flat();
      expect(flat).toHaveLength(6);
      const hidden = flat.filter(r => r.referent.endsWith('-hidden'));
      expect(hidden).toHaveLength(2);
      for (const r of hidden) expect(r.points).toBe(1);
      const visible = flat.filter(r =>
        result.splits.some(s => s.cell === r.referent)
      );
      for (const r of visible) expect(r.points).toBe(1);
    });

    it('totals 6 points (3 per correctable)', () => {
      expect(result.cells[0].points).toBe(3);
      expect(result.cells[1].points).toBe(3);
    });

    it('extracts 2 hidden test regions', () => {
      expect(result.splits).toHaveLength(2);
      for (const split of result.splits)
        expect(split.source).toContain('assert');
    });

    it('records visible sources for split test cells', () => {
      const ids = result.sources.map(s => s.id);
      for (const split of result.splits) expect(ids).toContain(split.cell);
    });

    it('visible sources have no hidden markers', () => {
      for (const { source } of result.sources) {
        expect(source).not.toContain('BEGIN HIDDEN');
        expect(source).not.toContain('END HIDDEN');
      }
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

/**
 * Upstream nbgrader test fixtures.
 *
 * These are the same notebooks nbgrader tests itself on, copied
 * verbatim from the installed package. If our converter handles every
 * one of these correctly, an instructor whose entire syllabus lives in
 * nbgrader source notebooks can migrate with confidence.
 */
describe('upstream nbgrader fixtures', () => {
  /**
   * Every upstream notebook whose metadata carries at least one cell
   * with grade=true, solution=true, or task=true.
   */
  const DETECTED: string[] = [
    // Schema versions
    'test-v0.ipynb',
    'test-v0-invalid.ipynb',
    // Task cell variant
    'test_taskcell.ipynb',
    // Autotest sources
    'autotest-simple.ipynb',
    'autotest-hashed.ipynb',
    'autotest-hidden.ipynb',
    'autotest-multi.ipynb',
    // Autotest submissions
    'autotest-simple-changed.ipynb',
    'autotest-simple-unchanged.ipynb',
    'autotest-hashed-changed.ipynb',
    'autotest-hashed-unchanged.ipynb',
    'autotest-hidden-changed-right.ipynb',
    'autotest-hidden-changed-wrong.ipynb',
    'autotest-hidden-unchanged.ipynb',
    'autotest-multi-changed.ipynb',
    'autotest-multi-unchanged.ipynb',
    // Submitted variants
    'submitted-unchanged.ipynb',
    'submitted-changed.ipynb',
    'submitted-locked-cell-changed.ipynb',
    'submitted-grade-cell-changed.ipynb',
    'submitted-cheat-attempt.ipynb',
    'submitted-cheat-attempt-alternative.ipynb',
    // Preprocessor edge cases
    'blank-points.ipynb',
    'blank-grade-id.ipynb',
    'duplicate-grade-ids.ipynb',
    'manually-graded-code-cell.ipynb',
    'bad-markdown-cell-1.ipynb',
    'bad-markdown-cell-2.ipynb',
    // Others
    'timeout.ipynb',
    'too-new.ipynb',
    'open_relative_file.ipynb',
    'validating-environment-variable.ipynb'
  ];

  /**
   * Notebooks that carry no actionable nbgrader metadata. Either no
   * nbgrader key at all, or only locked/read-only flags without
   * grade, solution, or task.
   */
  const NOT_DETECTED: string[] = [
    'test-no-metadata.ipynb',
    'test-no-metadata-autotest.ipynb',
    'infinite-loop.ipynb',
    'infinite-loop-with-output.ipynb',
    'side-effects.ipynb',
    'cell-type-changed.ipynb',
    'no-cell-type.ipynb'
  ];

  /** Fixtures that produce at least one rubric cell from classify(). */
  const CLASSIFIABLE: string[] = [
    // Full assignments (schema versions)
    'test-v0.ipynb',
    'test-v0-invalid.ipynb',
    'test_taskcell.ipynb',
    // Autotest sources
    'autotest-simple.ipynb',
    'autotest-hashed.ipynb',
    'autotest-hidden.ipynb',
    'autotest-multi.ipynb',
    // Autotest submissions
    'autotest-simple-changed.ipynb',
    'autotest-simple-unchanged.ipynb',
    'autotest-hashed-changed.ipynb',
    'autotest-hashed-unchanged.ipynb',
    'autotest-hidden-changed-right.ipynb',
    'autotest-hidden-changed-wrong.ipynb',
    'autotest-hidden-unchanged.ipynb',
    'autotest-multi-changed.ipynb',
    'autotest-multi-unchanged.ipynb',
    // Submitted
    'submitted-unchanged.ipynb',
    'submitted-changed.ipynb',
    'submitted-locked-cell-changed.ipynb',
    'submitted-grade-cell-changed.ipynb',
    'submitted-cheat-attempt.ipynb',
    'submitted-cheat-attempt-alternative.ipynb',
    // Minimal
    'manually-graded-code-cell.ipynb',
    'duplicate-grade-ids.ipynb',
    'bad-markdown-cell-2.ipynb',
    'timeout.ipynb'
  ];

  // -- Detection ----------------------------------------------------------

  describe('detect', () => {
    it.each(DETECTED)('%s is detected as nbgrader', name => {
      expect(detect(load(name))).toBe(true);
    });

    it.each(NOT_DETECTED)('%s is not detected as nbgrader', name => {
      expect(detect(load(name))).toBe(false);
    });
  });

  // -- Safety: classify never throws -------------------------------------

  describe('classify never throws', () => {
    it.each([...DETECTED, ...NOT_DETECTED])('%s', name => {
      expect(() => classify(load(name))).not.toThrow();
    });
  });

  // -- Structural invariants across all classifiable fixtures -------------

  describe('invariants', () => {
    it.each(CLASSIFIABLE)(
      '%s: all cell points are non-negative integers',
      name => {
        const result = classify(load(name));
        for (const cell of result.cells) {
          expect(cell.points).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(cell.points)).toBe(true);
        }
      }
    );

    it.each(CLASSIFIABLE)(
      '%s: all reference points are non-negative integers',
      name => {
        const result = classify(load(name));
        for (const refs of result.references)
          for (const ref of refs) {
            expect(ref.points).toBeGreaterThanOrEqual(0);
            expect(Number.isInteger(ref.points)).toBe(true);
          }
      }
    );

    it.each(CLASSIFIABLE)(
      '%s: every correctable has at least one reference',
      name => {
        const result = classify(load(name));
        for (let i = 0; i < result.cells.length; i++) {
          if (result.cells[i].is === 'correctable') {
            expect(result.cells[i].references!.length).toBeGreaterThanOrEqual(
              1
            );
            expect(result.references[i].length).toBeGreaterThanOrEqual(1);
          }
        }
      }
    );

    it.each(CLASSIFIABLE)(
      '%s: no output source contains solution markers',
      name => {
        const result = classify(load(name));
        for (const { source } of result.sources) {
          expect(source).not.toContain('BEGIN SOLUTION');
          expect(source).not.toContain('END SOLUTION');
        }
      }
    );

    it.each(CLASSIFIABLE)(
      '%s: no output source contains mark scheme markers',
      name => {
        const result = classify(load(name));
        for (const { source } of result.sources) {
          expect(source).not.toContain('BEGIN MARK SCHEME');
          expect(source).not.toContain('END MARK SCHEME');
        }
      }
    );

    it.each(CLASSIFIABLE)(
      '%s: cells and references arrays are aligned',
      name => {
        const result = classify(load(name));
        expect(result.references).toHaveLength(result.cells.length);
      }
    );

    it.each(CLASSIFIABLE)(
      '%s: correctable reference IDs match cell.references',
      name => {
        const result = classify(load(name));
        for (let i = 0; i < result.cells.length; i++) {
          const cell = result.cells[i];
          if (cell.is === 'correctable') {
            const ids = result.references[i].map(r => r.referent);
            expect(ids).toEqual(cell.references);
          }
        }
      }
    );

    it.each(CLASSIFIABLE)('%s: all references are marked secret', name => {
      const result = classify(load(name));
      for (const refs of result.references)
        for (const ref of refs) expect(ref.secret).toBe(true);
    });
  });

  // -- Schema compatibility -----------------------------------------------

  describe('schema compatibility', () => {
    const v3 = classify(load('test.ipynb'));
    const v0 = classify(load('test-v0.ipynb'));
    const v0i = classify(load('test-v0-invalid.ipynb'));
    const v1 = classify(load('test-v1.ipynb'));
    const v2 = classify(load('test-v2.ipynb'));
    const with_output = classify(load('test-with-output.ipynb'));

    it('v0 produces the same cell types as v3', () => {
      expect(v0.cells.map(c => c.is)).toEqual(v3.cells.map(c => c.is));
    });

    it('v0 produces the same point totals as v3', () => {
      expect(v0.cells.map(c => c.points)).toEqual(v3.cells.map(c => c.points));
    });

    it('v0-invalid produces the same cell types as v3', () => {
      expect(v0i.cells.map(c => c.is)).toEqual(v3.cells.map(c => c.is));
    });

    it('v0-invalid produces the same point totals as v3', () => {
      expect(v0i.cells.map(c => c.points)).toEqual(v3.cells.map(c => c.points));
    });

    it('all schema versions produce zero warnings', () => {
      for (const r of [v0, v0i, v1, v2, v3]) expect(r.warnings).toHaveLength(0);
    });

    it('test-with-output.ipynb is structurally identical to test.ipynb', () => {
      expect(with_output.cells.map(c => c.is)).toEqual(v3.cells.map(c => c.is));
      expect(with_output.cells.map(c => c.points)).toEqual(
        v3.cells.map(c => c.points)
      );
    });
  });

  // -- Submitted notebook equivalence -------------------------------------

  describe('submitted notebooks', () => {
    const canonical = classify(load('submitted-unchanged.ipynb'));

    it.each([
      'submitted-changed.ipynb',
      'submitted-locked-cell-changed.ipynb',
      'submitted-grade-cell-changed.ipynb',
      'submitted-cheat-attempt.ipynb',
      'submitted-cheat-attempt-alternative.ipynb'
    ])('%s matches canonical submitted classification', name => {
      const result = classify(load(name));
      expect(result.cells.map(c => c.is)).toEqual(
        canonical.cells.map(c => c.is)
      );
      expect(result.cells.map(c => c.points)).toEqual(
        canonical.cells.map(c => c.points)
      );
    });

    it('produces 3 rubric cells: 1 correctable + 2 reviewable', () => {
      expect(canonical.cells).toHaveLength(3);
      expect(canonical.cells[0].is).toBe('correctable');
      expect(canonical.cells[1].is).toBe('reviewable');
      expect(canonical.cells[2].is).toBe('reviewable');
    });

    it('totals 7 points', () => {
      const total = canonical.cells.reduce((sum, cell) => sum + cell.points, 0);
      expect(total).toBe(7);
    });

    it('correctable has 2 test references', () => {
      expect(canonical.cells[0].references).toHaveLength(2);
    });

    it('skips locked read-only cells', () => {
      // submitted notebooks have 7 tagged cells but only 5 carry
      // grade or solution; the 2 readonly (ro1, ro2) are skipped
      expect(canonical.cells).toHaveLength(3);
    });
  });

  // -- Task cells ---------------------------------------------------------

  describe('test_taskcell.ipynb', () => {
    const result = classify(load('test_taskcell.ipynb'));
    const canonical = classify(load('test.ipynb'));

    it('produces 5 rubric entries (task + 4 from canonical assignment)', () => {
      expect(result.cells).toHaveLength(5);
    });

    it('first cell is reviewable from task (2 points)', () => {
      expect(result.cells[0]).toMatchObject({
        is: 'reviewable',
        points: 2
      });
    });

    it('remaining 4 match test.ipynb structure', () => {
      expect(result.cells.slice(1).map(c => c.is)).toEqual(
        canonical.cells.map(c => c.is)
      );
      expect(result.cells.slice(1).map(c => c.points)).toEqual(
        canonical.cells.map(c => c.points)
      );
    });

    it('has no warnings', () => {
      expect(result.warnings).toHaveLength(0);
    });
  });

  // -- Autotest source notebooks ------------------------------------------

  describe('autotest source notebooks', () => {
    describe('autotest-simple.ipynb', () => {
      const result = classify(load('autotest-simple.ipynb'));

      it('produces 1 correctable with 1 test reference', () => {
        expect(result.cells).toHaveLength(1);
        expect(result.cells[0].is).toBe('correctable');
        expect(result.cells[0].references).toHaveLength(1);
      });

      it('strips solution markers from answer', () => {
        for (const { source } of result.sources)
          expect(source).not.toContain('BEGIN SOLUTION');
      });
    });

    describe('autotest-hashed.ipynb', () => {
      const result = classify(load('autotest-hashed.ipynb'));

      it('produces 1 correctable with 1 test reference', () => {
        expect(result.cells).toHaveLength(1);
        expect(result.cells[0].is).toBe('correctable');
        expect(result.cells[0].references).toHaveLength(1);
      });
    });

    describe('autotest-hidden.ipynb', () => {
      const raw = load('autotest-hidden.ipynb');
      const result = pipeline(raw);

      it('produces 1 correctable with visible and hidden references', () => {
        expect(result.cells).toHaveLength(1);
        expect(result.cells[0].is).toBe('correctable');
        const refs = result.cells[0].references!;
        expect(refs).toHaveLength(2);
        expect(refs[1]).toMatch(/-hidden$/);
      });

      it('assigns full points to both visible and hidden', () => {
        const flat = result.references.flat();
        const visible = flat.find(r => !r.referent.endsWith('-hidden'));
        const hidden = flat.find(r => r.referent.endsWith('-hidden'));
        expect(visible!.points).toBe(1);
        expect(hidden!.points).toBe(1);
      });

      it('splits hidden test region from test cell', () => {
        expect(result.splits).toHaveLength(1);
      });

      it('visible source has no hidden markers', () => {
        for (const { source } of result.sources) {
          expect(source).not.toContain('BEGIN HIDDEN');
          expect(source).not.toContain('END HIDDEN');
        }
      });

      it('expands autotest directives in both portions', async () => {
        const values: Record<string, string> = {
          a: '5',
          b: "'hello'",
          c: "[1, 2, 'test']",
          'type(a)': 'int',
          'type(b)': 'str',
          'type(c)': 'list'
        };
        const executed: string[] = [];
        const executor: Executor = async code => {
          executed.push(code);
          return values[code] ?? null;
        };
        const { cells } = presplit(raw);
        const expanded = await expand(cells, result, executor);

        // Answer cell was executed first.
        expect(executed[0]).toContain('a = 5');

        // Visible portion: type() assertions.
        const visible = expanded.sources.find(
          s => s.id === result.splits[0].cell
        );
        expect(visible).toBeDefined();
        expect(visible!.source).toContain(support);
        expect(visible!.source).toContain(invoke('type(a)', 'int'));
        expect(visible!.source).toContain(invoke('type(b)', 'str'));
        expect(visible!.source).toContain(invoke('type(c)', 'list'));
        expect(visible!.source).not.toContain('### AUTOTEST');

        // Hidden portion: value assertions (in sources under referent ID).
        const secret = expanded.sources.find(
          s => s.id === result.splits[0].referent
        );
        expect(secret).toBeDefined();
        expect(secret!.source).toContain(support);
        expect(secret!.source).toContain(invoke('a', '5'));
        expect(secret!.source).toContain(invoke('b', "'hello'"));
        expect(secret!.source).toContain(invoke('c', "[1, 2, 'test']"));
        expect(secret!.source).not.toContain('### AUTOTEST');

        expect(expanded.warnings).toHaveLength(0);
      });
    });

    describe('autotest-multi.ipynb', () => {
      const result = classify(load('autotest-multi.ipynb'));

      it('produces 1 correctable with 4 test references', () => {
        expect(result.cells).toHaveLength(1);
        expect(result.cells[0].is).toBe('correctable');
        expect(result.cells[0].references).toHaveLength(4);
      });

      it('totals 4 points', () => {
        expect(result.cells[0].points).toBe(4);
      });
    });
  });

  // -- Autotest submissions match sources ---------------------------------

  describe('autotest submissions match source structure', () => {
    it.each([
      ['autotest-simple-changed.ipynb', 'autotest-simple.ipynb'],
      ['autotest-simple-unchanged.ipynb', 'autotest-simple.ipynb'],
      ['autotest-hashed-changed.ipynb', 'autotest-hashed.ipynb'],
      ['autotest-hashed-unchanged.ipynb', 'autotest-hashed.ipynb'],
      ['autotest-multi-changed.ipynb', 'autotest-multi.ipynb'],
      ['autotest-multi-unchanged.ipynb', 'autotest-multi.ipynb']
    ])('%s matches cell types and points of %s', (submission, source) => {
      const s = pipeline(load(submission));
      const r = pipeline(load(source));
      expect(s.cells.map(c => c.is)).toEqual(r.cells.map(c => c.is));
      expect(s.cells.map(c => c.points)).toEqual(r.cells.map(c => c.points));
    });

    // Hidden submissions lack hidden test regions, so they have fewer
    // references and lower point totals than the source notebook.
    it.each([
      ['autotest-hidden-changed-right.ipynb', 'autotest-hidden.ipynb'],
      ['autotest-hidden-changed-wrong.ipynb', 'autotest-hidden.ipynb'],
      ['autotest-hidden-unchanged.ipynb', 'autotest-hidden.ipynb']
    ])('%s matches cell types of %s', (submission, source) => {
      const s = pipeline(load(submission));
      const r = pipeline(load(source));
      expect(s.cells.map(c => c.is)).toEqual(r.cells.map(c => c.is));
    });
  });

  // -- Autotest directive detection on fixture sources --------------------

  describe('autotests detection', () => {
    it.each([
      'autotest-simple.ipynb',
      'autotest-hashed.ipynb',
      'autotest-hidden.ipynb',
      'autotest-multi.ipynb'
    ])('%s: source contains autotest directives', name => {
      expect(load(name).some(c => autotests(c.source))).toBe(true);
    });

    it.each([
      'autotest-simple-changed.ipynb',
      'autotest-simple-unchanged.ipynb',
      'autotest-hashed-changed.ipynb',
      'autotest-hashed-unchanged.ipynb',
      'autotest-multi-changed.ipynb',
      'autotest-multi-unchanged.ipynb'
    ])('%s: expanded submission has no autotest directives', name => {
      expect(load(name).some(c => autotests(c.source))).toBe(false);
    });
  });

  // -- Edge cases from preprocessor fixtures ------------------------------

  describe('edge cases', () => {
    it('blank-points.ipynb: orphan test with null points warns', () => {
      const result = classify(load('blank-points.ipynb'));
      expect(result.cells).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('no preceding answer'))).toBe(
        true
      );
    });

    it('blank-grade-id.ipynb: orphan test with empty grade_id warns', () => {
      const result = classify(load('blank-grade-id.ipynb'));
      expect(result.cells).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('no preceding answer'))).toBe(
        true
      );
    });

    it('duplicate-grade-ids.ipynb: classifies the manual cell', () => {
      const result = classify(load('duplicate-grade-ids.ipynb'));
      expect(result.cells.some(c => c.is === 'reviewable')).toBe(true);
    });

    it('manually-graded-code-cell.ipynb: produces 1 reviewable', () => {
      const result = classify(load('manually-graded-code-cell.ipynb'));
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0].is).toBe('reviewable');
    });

    it('too-new.ipynb (v10 schema): trailing task warning', () => {
      const result = classify(load('too-new.ipynb'));
      expect(result.cells).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('Trailing task'))).toBe(true);
    });

    it('bad-markdown-cell-1.ipynb: grade-only markdown is task', () => {
      // grade=true, solution=false, markdown → task. No following
      // cell → trailing task warning.
      const result = classify(load('bad-markdown-cell-1.ipynb'));
      expect(result.cells).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('Trailing task'))).toBe(true);
    });

    it('bad-markdown-cell-2.ipynb: solution-only markdown is reviewable', () => {
      const result = classify(load('bad-markdown-cell-2.ipynb'));
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0].is).toBe('reviewable');
    });

    it('timeout.ipynb: answer + test produce 1 correctable', () => {
      const result = classify(load('timeout.ipynb'));
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0].is).toBe('correctable');
    });

    it('open_relative_file.ipynb: orphan test warns', () => {
      const result = classify(load('open_relative_file.ipynb'));
      expect(result.cells).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('no preceding answer'))).toBe(
        true
      );
    });

    it('validating-environment-variable.ipynb: orphan test warns', () => {
      const result = classify(load('validating-environment-variable.ipynb'));
      expect(result.cells).toHaveLength(0);
      expect(result.warnings.some(w => w.includes('no preceding answer'))).toBe(
        true
      );
    });
  });

  // -- Non-nbgrader notebooks produce empty classification ----------------

  describe('non-nbgrader notebooks classify cleanly', () => {
    it.each(NOT_DETECTED)('%s: produces zero cells', name => {
      const result = classify(load(name));
      expect(result.cells).toHaveLength(0);
      expect(result.references).toHaveLength(0);
    });
  });

  // -- clean() strips nbgrader from all fixtures --------------------------

  describe('clean strips nbgrader metadata', () => {
    it.each(DETECTED)(
      '%s: clean removes nbgrader key from every tagged cell',
      name => {
        for (const cell of load(name)) {
          if ('nbgrader' in cell.metadata) {
            const cleaned = clean(cell.metadata as Record<string, any>);
            expect('nbgrader' in cleaned).toBe(false);
          }
        }
      }
    );
  });
});
