import { Workbook } from '..';

type Certified = Workbook.Certified;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;
type Settled =
  | { status: 'fulfilled'; value: Certified }
  | { status: 'rejected'; reason: unknown; workbook: Headless };

export type Actions = {
  correct: (workbook: Headless) => Promise<Certified>;
  exclude: (workbook: Headless) => Certified | null;
  recover: (workbook: Headless) => Result.Failed;
};

export type Result = Result.Certified | Result.Failed;

export namespace Result {
  export type Certified = { ok: true; certified: Workbook.Certified };
  export type Failed = { ok: false; grade: Grade; workbook: Headless };
}

/**
 * Grade scanned workbooks with bounded in-flight concurrency.
 *
 * @param scanner - Cold async iterable of headless workbooks to grade.
 * @param actions - Functions orchestrated by the grader.
 *   - `correct`: async grading function.
 *   - `exclude`: synchronous fast path that returns a certified result when the
 *     workbook should be emitted immediately without grading.
 *   - `recover`: fallback result for failures after retries.
 * @param cap - Maximum number of workbooks being graded simultaneously.
 *   Values less than 1 are clamped to 1.
 * @param retries - How many times to retry a workbook where `correct` throws
 *   before giving up and calling `recover`. Workbooks that return
 *   `resolved: false` are not retried. Defaults to `0`.
 *
 * #### Notes
 * `grader` consumes `scanner` lazily: the next workbook is only fetched once a
 * concurrency slot is free, so the kernel pool never grows faster than grading
 * can drain it.
 *
 * Timeouts are not managed here, the kernel lease deadline (`kernels.lifespan`)
 * is the authoritative timeout because it starts after `acquire()` resolves,
 * not while waiting for a pool slot.
 *
 * Graded workbooks are yielded in completion order (fastest first).
 * Failures are recovered and yielded so a bad workbook cannot stall the batch.
 */
export async function* grade(
  scanner: Iterable<Headless> | AsyncIterable<Headless>,
  actions: Actions,
  cap: number,
  retries: number = 0
): AsyncGenerator<Result> {
  let next: (() => void) | null = null;
  let inflight = 0;
  const max = Math.max(1, cap);
  const queue: Settled[] = [];
  const attempts = new WeakMap<Headless, number>();
  const sleep = () => new Promise<void>(resolve => void (next = resolve));
  const wake = () => {
    next?.();
    next = null;
  };
  const start = (workbook: Headless) => {
    const { correct } = actions;
    inflight++;
    correct(workbook)
      .then(value => queue.push({ status: 'fulfilled', value }))
      .catch(reason => queue.push({ status: 'rejected', reason, workbook }))
      .finally(() => {
        inflight--;
        wake();
      });
  };

  const take = async (): Promise<Settled | null> => {
    while (!queue.length) {
      if (!inflight) return null;
      await sleep();
    }
    return queue.shift()!;
  };
  const emit = async (): Promise<Result | null> => {
    const settled = await take();
    if (!settled) return null;
    if (settled.status === 'fulfilled')
      return { ok: true, certified: settled.value };

    const tried = (attempts.get(settled.workbook) ?? 0) + 1;
    if (tried <= retries) {
      attempts.set(settled.workbook, tried);
      start(settled.workbook);
      return null;
    }
    attempts.delete(settled.workbook);
    console.warn('grader error', settled.workbook.context.path, settled.reason);
    return actions.recover(settled.workbook);
  };

  for await (const workbook of scanner) {
    const cached = actions.exclude(workbook);
    if (cached) {
      yield { ok: true, certified: cached };
      continue;
    }
    while (queue.length) {
      const result = await emit();
      if (result) yield result;
    }
    while (inflight >= max) {
      const result = await emit();
      if (result) yield result;
    }
    start(workbook);
  }

  while (inflight || queue.length) {
    const result = await emit();
    if (result) yield result;
  }
}
