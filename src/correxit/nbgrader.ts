import { ICell } from '@jupyterlab/nbformat';
import { IRenderMime } from '@jupyterlab/rendermime';
import { Kernel } from '@jupyterlab/services';
import * as kernels from './kernels';
import { Rubric } from './rubric';
import { Workbook } from './workbook';

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
  splits: { cell: string; referent: string; source: string }[];
  warnings: string[];
};
type Resolution = { safe: boolean; value: string | null; };
type Render = (expr: string, value: string) => string;
type Informative = Kernel.IKernelConnection & {
  info: Promise<{ language_info?: { name?: string | null } } | null>;
};

const AUTOTEST = /^###\s+(?:HASHED\s+)?AUTOTEST\s+(.+)$/;
const BEGIN_SOLUTION = /^#{3,}\s*BEGIN\s+SOLUTION\s*$/;
const END_SOLUTION = /^#{3,}\s*END\s+SOLUTION\s*$/;
const BEGIN_HIDDEN = /^#{3,}\s*BEGIN\s+HIDDEN\s+TESTS?\s*$/;
const END_HIDDEN = /^#{3,}\s*END\s+HIDDEN\s+TESTS?\s*$/;
const BEGIN_MARK = /^={3,}\s*BEGIN\s+MARK\s+SCHEME\s*={3,}$/;
const END_MARK = /^={3,}\s*END\s+MARK\s+SCHEME\s*={3,}$/;
const VERIFY = '__correxit_autotest__';
const VALUE = '__correxit_autotest_value__';
const support = `def ${VERIFY}(label, actual, expected):
    if actual != expected:
      raise AssertionError(f"{label}: expected {expected!r}, got {actual!r}")`;

/**
 * Returns true if at least one cell carries nbgrader metadata with
 * `grade === true`, `solution === true`, or `task === true`.
 */
export function detect(cells: Cellular[]): boolean {
  return cells.some(cell => {
    const nbgrader = cell.metadata.nbgrader as Partial<Metadata> | undefined;
    return nbgrader?.grade === true
      || nbgrader?.solution === true
      || nbgrader?.task === true;
  });
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

/**
 * Extract hidden test regions from a test cell source.
 *
 * Returns the visible and hidden portions, or null when no
 * hidden test markers are present.
 */
export function hidden(
  source: string
): { visible: string; hidden: string } | null {
  const lines = source.split('\n');
  const visible: string[] = [];
  const extracted: string[] = [];
  let inside = false;
  let found = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (BEGIN_HIDDEN.test(trimmed)) {
      inside = true;
      found = true;
      continue;
    }
    if (END_HIDDEN.test(trimmed)) {
      inside = false;
      continue;
    }
    if (inside) extracted.push(line);
    else visible.push(line);
  }
  if (!found) return null;
  return {
    visible: visible.join('\n').trimEnd(),
    hidden: extracted.join('\n')
  };
}

/**
 * Pre-split cells containing hidden test regions.
 *
 * Test cells with BEGIN HIDDEN / END HIDDEN markers become two cells:
 * the visible portion (same ID, original points) and the hidden
 * portion (synthetic ID, original points). Both halves receive the
 * same point value (clamped to >= 0), so split tests can increase
 * the converted total. This runs before classify() so that
 * classification never reasons about mid-stride splits.
 */
export function presplit(cells: Cellular[]): {
  cells: Cellular[];
  sources: { id: string; source: string }[];
  splits: { cell: string; referent: string; source: string }[];
} {
  const expanded: Cellular[] = [];
  const sources: { id: string; source: string }[] = [];
  const splits: { cell: string; referent: string; source: string }[] = [];
  for (const cell of cells) {
    const meta = cell.metadata.nbgrader as Partial<Metadata> | undefined;
    const test =
      meta?.grade === true && meta?.solution !== true
      && cell.cell_type === 'code';
    if (!test) { expanded.push(cell); continue; }

    const split = hidden(cell.source);
    if (!split || !split.visible.trim()) {
      expanded.push(cell);
      if (split) sources.push({ id: cell.id, source: split.hidden });
      continue;
    }

    const referent = `${cell.id}-hidden`;
    const points = Math.max(0, meta!.points ?? 1);

    // Visible portion: same ID, same points as the original.
    expanded.push({
      ...cell,
      source: split.visible,
      metadata: {
        ...cell.metadata,
        nbgrader: { ...(meta as Metadata), points }
      }
    });

    // Hidden portion: synthetic cell with the same points.
    expanded.push({
      id: referent,
      cell_type: 'code',
      source: split.hidden,
      metadata: {
        nbgrader: {
          grade: true,
          grade_id: referent,
          locked: true,
          points,
          schema_version: meta!.schema_version ?? 3,
          solution: false
        }
      }
    });
    sources.push({ id: cell.id, source: split.visible });
    splits.push({ cell: cell.id, referent, source: split.hidden });
  }
  return { cells: expanded, sources, splits };
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
    if (integral) return values.map(value => Math.round(value * scale));
  }
  return values.map(value => Math.round(value * 100));
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
    splits: [],
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
      const answer = meta.solution === true && meta.grade !== true;
      const manual = meta.grade === true && meta.solution === true;
      const task = meta.task === true || (
        meta.grade === true
        && meta.solution !== true
        && cell.cell_type === 'markdown'
      );
      const test =
        meta.grade === true && meta.solution !== true
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

/**
 * Compare the sum of nbgrader metadata points to the converted rubric
 * total. Returns the original metadata total when it differs (due to
 * recalibration, rounding, or discarded cells), or null when the
 * totals agree.
 */
export function slippage(
  cells: Cellular[],
  classification: Classification
): number | null {
  let total = 0;
  let found = false;
  for (const cell of cells) {
    const nbgrader = cell.metadata.nbgrader as Partial<Metadata> | undefined;
    if (nbgrader?.points === null || nbgrader?.points === undefined) continue;
    if (!nbgrader.grade && !nbgrader.solution && !nbgrader.task) continue;
    total += Math.max(0, nbgrader.points);
    found = true;
  }
  if (!found) return null;
  const rubric = classification.cells.reduce(
    (sum, cell) => sum + cell.points, 0
  );
  return total === rubric ? null : total;
}

/** Build a summary report for a completed nbgrader conversion. */
export function report(
  source: Cellular[],
  classification: Classification,
  trans: IRenderMime.TranslationBundle
): string[] {
  const { cells, splits, warnings } = classification;
  const correctable = cells.filter(({ is }) => is === 'correctable');
  const reviewable = cells.filter(({ is }) => is === 'reviewable');
  const points = cells.reduce((sum, { points }) => sum + points, 0);
  const lines = [
    trans.__('This notebook was rewritten in place as a Correxit workbook.'),
    '',
    trans.__(
      '%1 auto-graded, %2 manually graded, %3 total points.',
      correctable.length, reviewable.length, points
    ),
    trans.__(
      'Keep the original nbgrader notebook until you are satisfied with the conversion.'
    )
  ];
  if (splits.length)
    lines.push(trans.__('%1 hidden test regions extracted.', splits.length));

  const original = slippage(source, classification);
  if (original !== null) {
    lines.push(
      trans.__(
        'Original nbgrader total: %1 points. Converted: %2.', original, points
      ),
      trans.__(
        'Correxit scales fractional points to integers and rounds if necessary'
      ),
      trans.__('Check the values in the sidebar.')
    );
  }
  if (warnings.length) {
    lines.push('');
    for (const warning of warnings) lines.push(`\u26a0 ${warning}`);
  }
  lines.push('');
  lines.push(
    trans.__('Expand the Correxit sidebar to inspect each cell configuration.')
  );
  return lines;
}

/**
 * Execute code and return the `text/plain` execute_result, or null on
 * failure or when the code produces no result.
 */
export type Executor = (code: string) => Promise<string | null>;

type Resolver = (expr: string) => Promise<Resolution>;

type Outcome = { ok: boolean; value: string | null; };

function placeholder(expr: string, value: string | null): string {
  const note = JSON.stringify(
    `Correxit could not safely convert AUTOTEST: ${expr}`
  );
  const lines = [
    '# Correxit could not safely convert this AUTOTEST.',
    '# Review and rewrite this reference cell manually.',
    '# Original directive:',
    `# ### AUTOTEST ${expr}`
  ];
  if (value !== null) {
    lines.push('# Observed kernel value:');
    lines.push(...value.split('\n').map(line => `# ${line}`));
  }
  lines.push(`raise NotImplementedError(${note})`);
  return lines.join('\n');
}

function python(expr: string, value: string): string {
  return `${VERIFY}(${JSON.stringify(expr)}, (${expr}), ${value})`;
}

/** Parse autotest directives from a cell source. */
function directives(source: string): { line: number; expressions: string[] }[] {
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

function request(
  kernel: Kernel.IKernelConnection,
  code: string
): Promise<Outcome> {
  return new Promise(resolve => {
    const future = kernel.requestExecute({ code }, true);
    let value: string | null = null;
    future.onIOPub = msg => {
      if (msg.header.msg_type === 'execute_result') {
        const data = (msg.content as any).data;
        value = data?.['text/plain'] ?? null;
      }
    };
    future.done
      .then(({ content }) => resolve({ ok: content.status === 'ok', value }))
      .catch(() => resolve({ ok: false, value: null }));
  });
}

/** Build an executor backed by a live kernel connection. */
function executor(kernel: Kernel.IKernelConnection): Executor {
  return async code => {
    const { ok, value } = await request(kernel, code);
    return ok ? value : null;
  };
}

function guess(name: string | null | undefined): string | null {
  const label = name?.toLowerCase() ?? null;
  if (!label) return null;
  return label.includes('python') ? 'python' : label;
}

async function language(
  kernel: Kernel.IKernelConnection
): Promise<string | null> {
  const info = await (kernel as Informative).info.catch(_ => null);
  const name = guess(info?.language_info?.name);
  if (name) return name;

  const spec = await kernel.spec.catch(_ => null);
  return guess(spec?.language || kernel.name);
}

function resolver(
  kernel: Kernel.IKernelConnection,
  render: Render
): Resolver {
  return async expr => {
    const observed = await request(kernel, `${VALUE} = (${expr})\n${VALUE}`);
    if (!observed.ok || observed.value === null)
      return { safe: false, value: observed.value };

    const validated = await request(
      kernel,
      [support, render(expr, observed.value)].join('\n\n')
    );
    return { safe: validated.ok, value: observed.value };
  };
}

/** AUTOTEST expand() logic (separated for unit testing without a kernel). */
export async function spread(
  cells: Cellular[],
  classification: Classification,
  execute: Executor,
  resolve?: Resolver,
  render: Render = python
): Promise<Classification> {
  const answers = new Set(
    classification.cells
      .filter(({ is }) => is === 'correctable')
      .map(({ id }) => id)
  );
  const referents = new Set(
    classification.references.flat().map(({ referent }) => referent)
  );
  const stripped = new Map(
    classification.sources.map(({ id, source }) => [id, source])
  );
  const expanded: { id: string; source: string }[] = [];
  const warnings: string[] = [];
  const inspect = resolve || (async (expr: string) => {
    const value = await execute(expr);
    return { safe: value !== null, value };
  });
  const rewrite = async (
    id: string,
    source: string
  ): Promise<string | null> => {
    const autotests = directives(source);
    if (!autotests.length) {
      await execute(source);
      return null;
    }

    let pending: string[] = [];
    const lines = source.split('\n');
    const on = new Set(autotests.map(({ line }) => line));
    const output: string[] = [];
    const flush = async () => {
      if (!pending.length) return;
      const block = pending.join('\n');
      output.push(...pending);
      pending = [];
      if (block.trim()) await execute(block);
    };
    let prepared = false;
    for (let i = 0; i < lines.length; i++) {
      if (!on.has(i)) {
        pending.push(lines[i]);
        continue;
      }
      await flush();

      const directive = autotests.find(({ line }) => line === i)!;
      for (const expr of directive.expressions) {
        const { safe, value } = await inspect(expr);
        if (safe && value !== null) {
          if (!prepared) {
            output.push(support, '');
            prepared = true;
          }
          output.push(render(expr, value));
        } else {
          warnings.push(value === null
            ? `Expansion failed for "${expr}" in cell "${id}"`
            : `Could not safely convert AUTOTEST "${expr}" in cell "${id}"`
          );
          output.push(placeholder(expr, value));
        }
      }
    }
    await flush();
    return output.join('\n');
  };
  for (const cell of cells) {
    if (answers.has(cell.id)) {
      await execute(stripped.get(cell.id) ?? cell.source);
      continue;
    }
    if (!referents.has(cell.id)) continue;

    const source = stripped.get(cell.id) ?? cell.source;
    const result = await rewrite(cell.id, source);
    if (result !== null)
      expanded.push({ id: cell.id, source: result });
  }

  const overwritten = new Set(expanded.map(({ id }) => id));
  return {
    ...classification,
    sources: [
      ...classification.sources.filter(({ id }) => !overwritten.has(id)),
      ...expanded
    ],
    warnings: [...classification.warnings, ...warnings]
  };
}

/**
 * Expand autotest directives in test cells by leasing a kernel,
 * executing answer cells for their definitions, then evaluating each
 * expression and replacing directives with generated Python tests.
 *
 * Returns the classification unchanged (with a warning) when no
 * kernel is available.
 */
export async function expand(
  workbook: Workbook,
  cells: Cellular[],
  classification: Classification
): Promise<Classification> {
  const leased = await kernels.lease(workbook);
  if (!leased) {
    const { defaultKernelName: name } = workbook.context.model;
    const warnings = [
      ...classification.warnings,
      `AUTOTEST and HASHED AUTOTEST cells could not be expanded (no ${
        name ?? 'kernel'
      } available); the rest of conversion continued unchanged`
    ];
    return { ...classification, warnings };
  }

  const [kernel, release] = leased;
  try {
    const fallback = workbook.context.model.defaultKernelName || null;
    const name = await language(kernel) ?? guess(fallback);
    const execute = executor(kernel);
    if (name !== 'python') {
      const resolve: Resolver =
        async expr => ({ safe: false, value: await execute(expr) });
      const warnings = [
        ...classification.warnings,
        `Only AUTOTEST and HASHED AUTOTEST expansion requires a Python kernel; found "${
          name ?? fallback ?? 'unknown'
        }". The rest of conversion continued unchanged`
      ];
      return await spread(
        cells, { ...classification, warnings }, execute, resolve
      );
    }
    return await spread(
      cells,
      classification,
      execute,
      resolver(kernel, python)
    );
  } finally {
    void release();
  }
}

/**
 * Detect, classify, and apply nbgrader cell metadata to a workbook.
 *
 * @returns a summary report on success, or null when the notebook
 * contains no nbgrader metadata.
 */
export async function convert(
  workbook: Workbook,
  trans: IRenderMime.TranslationBundle
): Promise<string[] | null> {
  const notebook = workbook.context.model.sharedModel;
  const raw: Cellular[] = notebook.cells.map(cell => ({
    id: cell.id,
    cell_type: cell.cell_type,
    source: cell.getSource(),
    metadata: cell.toJSON().metadata as Record<string, any>
  }));
  if (!detect(raw)) return null;

  // Pass 1: split hidden test regions into separate cells.
  const { cells, sources: initial, splits } = presplit(raw);

  // Pass 2: classify the (already-split) cells.
  let classification = classify(cells);
  classification = {
    ...classification,
    sources: [...initial, ...classification.sources],
    splits
  };

  const referents = new Set(
    classification.references.flat().map(ref => ref.referent)
  );
  const pending = cells.some(cell =>
    referents.has(cell.id) && autotests(cell.source)
  );
  if (pending)
    classification = await expand(workbook, cells, classification);

  for (const warning of classification.warnings)
    console.warn('nbgrader convert:', warning);

  // Build source cache once for both split insertion and final cleanup.
  const cached = new Map(
    classification.sources.map(({ id, source }) => [id, source])
  );

  // Insert hidden test cells extracted by presplit.
  for (const split of classification.splits) {
    const index = notebook.cells.findIndex(({ id }) => id === split.cell);
    if (index < 0) continue;
    notebook.insertCell(index + 1, {
      cell_type: 'code',
      source: cached.get(split.referent) ?? split.source,
      metadata: {}
    });

    const actual = notebook.cells[index + 1].id;
    if (actual === split.referent) continue;
    for (const references of classification.references) {
      for (const ref of references) {
        if (ref.referent === split.referent)
          (ref as { referent: string }).referent = actual;
      }
    }
    for (const cell of classification.cells) {
      if (!cell.references) continue;
      (cell as { references: string[] }).references =
        cell.references.map(id => id === split.referent ? actual : id);
    }
  }
  for (let i = 0; i < classification.cells.length; i++) {
    await Workbook.add(
      workbook, classification.cells[i], classification.references[i]
    );
  }
  notebook.transact(() => {
    for (const cell of [...notebook.cells]) {
      const json = cell.toJSON();
      const source = cached.get(cell.id);
      const metadata = json.metadata as Record<string, any> | undefined;
      const marked = !!metadata && 'nbgrader' in metadata;
      if (source === undefined && !marked) continue;

      // Rewrite in place so rubric cell IDs stay aligned with notebook cells.
      cell.transact(() => {
        if (source !== undefined) cell.setSource(source);
        if (marked) cell.deleteMetadata('nbgrader');
      });
    }
  }, false);
  return report(raw, classification, trans);
}
