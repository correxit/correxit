import { Workbook } from '..';

type Certified = Workbook.Certified;
type Headless = Workbook.Headless;
type Settled =
  | { ok: true; grade: Certified }
  | { ok: false; error: unknown; workbook: Headless };

export type Actions = {
  correct: (workbook: Headless) => Promise<Certified>;
  recover: (workbook: Headless) => Certified;
  skip: (workbook: Headless) => Certified | null;
};

/**
 * Grade scanned workbooks with bounded in-flight concurrency.
 *
 * @param scanner - Cold async iterable of headless workbooks to grade.
 * @param actions - Functions orchestrated by the grader.
 *   - `correct`: async grading function.
 *   - `recover`: fallback result for failures after retries.
 *   - `skip`: synchronous fast path that returns a certified result when the
 *     workbook should be emitted immediately without grading.
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
 * Timeouts are not managed here — the kernel lease deadline (`kernels.lifespan`)
 * is the authoritative timeout because it starts after `acquire()` resolves,
 * not while waiting for a pool slot.
 *
 * Graded workbooks are yielded in completion order (fastest first).
 * Failures are recovered and yielded so a bad workbook cannot stall the batch.
 */
export async function* grader(
  scanner: Iterable<Headless> | AsyncIterable<Headless>,
  actions: Actions,
  cap: number,
  retries: number = 0
): AsyncGenerator<Certified> {
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
      .then(grade => queue.push({ ok: true, grade }))
      .catch(error => queue.push({ ok: false, error, workbook }))
      .finally(() => {
        inflight--;
        wake();
      });
  };

  const take = async (): Promise<Settled | null> => {
    while (!queue.length) {
      if (!inflight) {
        return null;
      }
      await sleep();
    }
    return queue.shift()!;
  };
  const emit = async (): Promise<Certified | null> => {
    const item = await take();
    if (!item) {
      return null;
    }
    if (item.ok) {
      return item.grade;
    }
    const tried = (attempts.get(item.workbook) ?? 0) + 1;
    if (tried <= retries) {
      attempts.set(item.workbook, tried);
      start(item.workbook);
      return null;
    }
    attempts.delete(item.workbook);
    console.warn('grader error', item.workbook.context.path, item.error);
    return actions.recover(item.workbook);
  };

  for await (const workbook of scanner) {
    const cached = actions.skip(workbook);
    if (cached) {
      yield cached;
      continue;
    }
    while (inflight >= max) {
      const grade = await emit();
      if (grade) {
        yield grade;
      }
    }
    start(workbook);
  }

  while (inflight || queue.length) {
    const grade = await emit();
    if (grade) {
      yield grade;
    }
  }
}
