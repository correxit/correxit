import { ICell } from '@jupyterlab/nbformat';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Kernel } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';
import * as kernels from './kernels';
import { Rubric } from './rubric';
import { Workbook } from './workbook';

type TranslationBundle = IRenderMime.TranslationBundle;

type Cell = Rubric.Cell;
type Reference = Rubric.Cell.Reference;

/** Per-cell nbgrader metadata (schema v1/v2/v3). */
type Metadata = {
  grade: boolean;
  grade_id: string;
  locked: boolean;
  points: number | null;
  schema_version: number;
  solution: boolean;
  task?: boolean;
  cell_type?: string;
  checksum?: string;
};

/**
 * Minimal cell projection consumed by detection and classification.
 *
 * Callers must join multiline sources and ensure `id` is present
 * before passing cells in.
 */
export type Cellular =
  Pick<ICell, 'cell_type' | 'metadata'> & { id: string; source: string };

/**
 * Classification output: Correxit cells and their references, plus any
 * diagnostic warnings the instructor should see.
 */
type Classification = {
  cells: Cell[];
  references: Reference[][];
  sources: { id: string; source: string }[];
  warnings: string[];
};

/**
 * Returns true if at least one cell carries nbgrader metadata with
 * `grade === true` or `solution === true`.
 */
export function detect(cells: Cellular[]): boolean {
  return cells.some(cell => {
    const meta = cell.metadata.nbgrader as
      Partial<Metadata> | undefined;
    return meta?.grade === true
      || meta?.solution === true
      || meta?.task === true;
  });
}

/**
 * Walk cells top-to-bottom and classify into rubric entries.
 *
 * Linkage: nbgrader has no explicit answer-to-test link. Tests
 * follow their answer in notebook order; intervening markdown,
 * read-only, and unmarked cells do not break the chain.
 *
 * | nbgrader         | metadata flags            | correxit    |
 * |------------------|---------------------------|-------------|
 * | Autograded answer| solution, !grade          | correctable |
 * | Autograder tests | grade, !solution, code    | reference   |
 * | Manual answer    | grade, solution           | reviewable  |
 * | Manual task      | task (or grade+md)        | reviewable  |
 * | Read-only/locked | locked, !grade, !solution | (skip)      |
 * | Unmarked         | no nbgrader key           | (skip)      |
 */
export function classify(cells: Cellular[]): Classification {
  let answer: {
    id: string;
    tests: { id: string; points: number }[];
  } | null = null;
  const result: Classification = {
    cells: [],
    references: [],
    sources: [],
    warnings: []
  };
  const flush = () => {
    if (!answer) return;

    const { id, tests } = answer;
    answer = null;
    if (tests.length) {
      const scaled = recalibrate(tests.map(test => test.points));
      const points = scaled.reduce((sum, value) => sum + value, 0);
      const cell: Cell = {
        id, is: 'correctable', payload: null, points,
        references: tests.map(test => test.id)
      };
      const references: Reference[] = tests.map((test, i) => ({
        cell: id,
        referent: test.id,
        points: scaled[i],
        secret: true
      }));
      result.cells.push(cell);
      result.references.push(references);
    } else {
      const warn = `No test cells: autograded answer ${id} set to reviewable`;
      result.warnings.push(warn);

      const cell: Cell = {
        id, is: 'reviewable', payload: null,
        points: 1, references: null
      };
      result.cells.push(cell);
      result.references.push([]);
    }
  };

  // Pending task description waiting for its working cell.
  let task: { points: number } | null = null;
  for (const cell of cells) {
    const meta = cell.metadata.nbgrader as Partial<Metadata> | undefined;
    if (!meta || (
      meta.grade !== true
      && meta.solution !== true
      && meta.task !== true
    )) {
      // Unmarked cell. If a task is pending, this is it.
      if (task) {
        flush();

        const points = Math.round(task.points);
        task = null;
        result.cells.push({
          id: cell.id, is: 'reviewable', payload: null,
          points, references: null
        });
        result.references.push([]);
      }
      continue;
    }

    const is = (() => {
      const answer = meta.solution === true && meta.grade === false;
      const manual = meta.grade === true && meta.solution === true;
      const task = meta.task === true || (
        meta.grade === true
        && meta.solution === false
        && cell.cell_type === 'markdown'
      );
      const test =
        meta.grade === true && meta.solution === false
        && !task && cell.cell_type === 'code';
      return { answer, manual, task, test };
    })();
    const points = Math.max(0, meta.points ?? 1);
    if (is.task) {
      flush();
      task = { points };
      continue;
    }
    if (task) {
      // Clear pending task not consumed by an unmarked cell.
      const warn = 'Task cell had no following unmarked cell; points discarded';
      result.warnings.push(warn);
      task = null;
    }
    if (is.answer) {
      flush();
      answer = { id: cell.id, tests: [] };

      const stripped = strip(cell.source);
      if (stripped !== cell.source)
        result.sources.push({ id: cell.id, source: stripped });
      continue;
    }
    if (is.test) {
      if (answer) {
        answer.tests.push({ id: cell.id, points });
      } else {
        const warn = `Test cell "${cell.id}" has no preceding answer; skipped`;
        result.warnings.push(warn);
      }
      continue;
    }
    if (is.manual) {
      flush();
      result.cells.push({
        id: cell.id, is: 'reviewable', payload: null,
        points: Math.round(points), references: null
      });
      result.references.push([]);

      const stripped = strip(cell.source);
      if (stripped !== cell.source)
        result.sources.push({ id: cell.id, source: stripped });
      continue;
    }
  }
  flush();
  if (task) {
    const warn = 'Trailing task cell had no following working cell; discarded';
    result.warnings.push(warn);
  }
  return result;
}

/**
 * Scale point values to the smallest integers preserving their ratios.
 *
 * #### Notes
 * nbgrader commonly splits a cell's total across tests as fractions
 * (e.g. 0.5 + 0.5). Correxit requires integer points. This finds the
 * smallest multiplier k such that every value * k is integral.
 */
function recalibrate(values: number[]): number[] {
  for (let scale = 1; scale <= 1000; scale++) {
    const integral = values.every(
      value => Math.abs(value * scale - Math.round(value * scale)) < 1e-9
    );
    if (integral)
      return values.map(value => Math.round(value * scale));
  }
  return values.map(value => Math.round(value * 100));
}

const AUTOTEST = /^###\s+(?:HASHED\s+)?AUTOTEST\s+(.+)$/;
const BEGIN_SOLUTION = /^#{3,}\s*BEGIN\s+SOLUTION\s*$/;
const END_SOLUTION = /^#{3,}\s*END\s+SOLUTION\s*$/;
const BEGIN_MARK = /^={3,}\s*BEGIN\s+MARK\s+SCHEME\s*={3,}$/;
const END_MARK = /^={3,}\s*END\s+MARK\s+SCHEME\s*={3,}$/;

/** Returns true if the source contains autotest directives. */
export function autotests(source: string): boolean {
  return source.split('\n').some(line => AUTOTEST.test(line.trim()));
}

/** Remove the `nbgrader` key from a metadata object. */
export function clean(
  metadata: Record<string, any>
): Record<string, any> {
  const { nbgrader, ...rest } = metadata;
  void nbgrader;
  return rest;
}

/** Build a summary widget for a completed nbgrader conversion. */
export function report(
  classification: Classification,
  trans: TranslationBundle
): Widget {
  const { cells, warnings } = classification;
  const correctable = cells.filter(cell => cell.is === 'correctable');
  const reviewable = cells.filter(cell => cell.is === 'reviewable');
  const points = cells.reduce((sum, cell) => sum + cell.points, 0);
  const lines = [
    trans.__('Converted from nbgrader format.'),
    '',
    trans.__(
      '%1 auto-graded, %2 manually graded, %3 total points.',
      correctable.length, reviewable.length, points
    )
  ];
  if (warnings.length) {
    lines.push('');
    for (const warning of warnings) lines.push(`\u26a0 ${warning}`);
  }
  lines.push('');
  lines.push(
    trans.__('Select a cell to review its configuration in the sidebar.')
  );

  const node = document.createElement('span');
  lines.forEach((line, i) => {
    if (i > 0) node.appendChild(document.createElement('br'));
    node.appendChild(document.createTextNode(line));
  });
  return new Widget({ node });
}

type Directive = { line: number; expressions: string[] };

/** Parse autotest directives from a cell source. */
function directives(source: string): Directive[] {
  return source.split('\n')
    .map((raw, line) => ({ raw, line }))
    .filter(({ raw }) => AUTOTEST.test(raw.trim()))
    .map(({ raw, line }) => {
      const match = raw.trim().match(AUTOTEST)!;
      const expressions = match[1]
        .split(';')
        .map(expr => expr.trim())
        .filter(Boolean);
      return { line, expressions };
    });
}

/**
 * Execute code and return the `text/plain` execute_result, or null on
 * failure or when the code produces no result.
 */
export type Executor = (code: string) => Promise<string | null>;

/** Build an executor backed by a live kernel connection. */
function executor(kernel: Kernel.IKernelConnection): Executor {
  return code =>
    new Promise(resolve => {
      const future = kernel.requestExecute({ code }, true);
      let result: string | null = null;
      future.onIOPub = msg => {
        if (msg.header.msg_type === 'execute_result') {
          const data = (msg.content as any).data;
          result = data?.['text/plain'] ?? null;
        }
      };
      future.done
        .then(reply =>
          resolve(reply.content.status === 'ok' ? result : null)
        )
        .catch(() => resolve(null));
    });
}

/**
 * Expand autotest directives in test cells by leasing a kernel, executing
 * answer cells for their definitions, then evaluating each autotest
 * expression and replacing directives with concrete assertions.
 *
 * If no kernel is available, returns the classification unchanged with a
 * warning appended.
 */
export async function expand(
  workbook: Workbook,
  cells: Cellular[],
  classification: Classification
): Promise<Classification> {
  const leased = await kernels.lease(workbook, { async: true });
  if (!leased) {
    const name = workbook.context.model.defaultKernelName;
    return {
      ...classification,
      warnings: [
        ...classification.warnings,
        `Autotest cells could not be expanded (no ${name} kernel available)`
      ]
    };
  }
  const [kernel, release] = leased;
  try {
    return await expand.pure(cells, classification, executor(kernel));
  } finally {
    await release();
  }
}

export namespace expand {
  /** Pure expansion logic, separated for unit testing without a kernel. */
  export async function pure(
    cells: Cellular[],
    classification: Classification,
    execute: Executor
  ): Promise<Classification> {
    const answers = new Set(
      classification.cells
        .filter(cell => cell.is === 'correctable')
        .map(cell => cell.id)
    );
    const referents = new Set(
      classification.references.flat().map(ref => ref.referent)
    );
    const stripped = new Map(
      classification.sources.map(({ id, source }) => [id, source])
    );

    const expanded: { id: string; source: string }[] = [];
    const warnings: string[] = [];

    for (const cell of cells) {
      if (answers.has(cell.id)) {
        await execute(stripped.get(cell.id) ?? cell.source);
        continue;
      }
      if (!referents.has(cell.id)) continue;

      const found = directives(cell.source);
      if (!found.length) {
        await execute(cell.source);
        continue;
      }

      const lines = cell.source.split('\n');
      const on = new Set(
        found.map(directive => directive.line)
      );
      const output: string[] = [];
      let pending: string[] = [];

      const flush = async () => {
        if (!pending.length) return;
        const block = pending.join('\n');
        output.push(...pending);
        pending = [];
        if (block.trim()) await execute(block);
      };

      let ok = true;
      for (let i = 0; i < lines.length; i++) {
        if (!on.has(i)) { pending.push(lines[i]); continue; }
        await flush();
        const directive = found.find(
          directive => directive.line === i
        )!;
        for (const expr of directive.expressions) {
          const value = await execute(expr);
          if (value !== null) {
            output.push(`assert ${expr} == ${value}`);
          } else {
            ok = false;
            warnings.push(
              `Expansion failed for "${expr}" in cell "${cell.id}"`
            );
            output.push(`### AUTOTEST ${expr}`);
          }
        }
      }
      await flush();
      if (ok)
        expanded.push({ id: cell.id, source: output.join('\n') });
    }

    return {
      ...classification,
      sources: [...classification.sources, ...expanded],
      warnings: [...classification.warnings, ...warnings]
    };
  }
}

/**
 * Strip solution and mark-scheme markers from cell source.
 *
 * Solution markers (`### BEGIN/END SOLUTION`): the marker lines are
 * removed but solution code between them is kept.
 *
 * Mark-scheme regions (`=== BEGIN/END MARK SCHEME ===`): everything
 * between the markers (inclusive) is dropped.
 */
export function strip(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let marking = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (BEGIN_MARK.test(trimmed)) { marking = true; continue; }
    if (END_MARK.test(trimmed)) { marking = false; continue; }
    if (marking) continue;
    if (BEGIN_SOLUTION.test(trimmed)) continue;
    if (END_SOLUTION.test(trimmed)) continue;
    out.push(line);
  }
  return out.join('\n');
}
