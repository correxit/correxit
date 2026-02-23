import { Workbook } from '..';

type Certified = Workbook.Certified;
type Headless = Workbook.Headless;
type Settled =
  | { ok: true; grade: Certified }
  | { ok: false; error: unknown; workbook: Headless };

/**
 * Grade scanned workbooks with bounded in-flight concurrency.
 *
 * @param scanner - Cold async iterable of headless workbooks to grade.
 * @param correct - Async function that grades a single workbook and returns
 *   the certified result. Errors thrown here are caught and recovered.
 * @param recover - Function that converts a failed workbook into a synthetic
 *   certified result for the consumer. The error is logged before recovery.
 * @param cap - Maximum number of workbooks being graded simultaneously.
 *   Values less than 1 are clamped to 1.
 * @param timeout - Milliseconds before a single workbook grade is abandoned.
 *   Pass `0` to disable the timeout.
 *
 * #### Notes
 * `grader` consumes `scanner` lazily: the next workbook is only fetched once a
 * concurrency slot is free, so the kernel pool never grows faster than grading
 * can drain it.
 *
 * Graded workbooks are yielded in completion order (fastest first).
 * Failures are recovered and yielded so a bad workbook cannot stall the batch.
 */
export async function* grader(
  scanner: Iterable<Headless> | AsyncIterable<Headless>,
  correct: (workbook: Headless) => Promise<Certified>,
  recover: (workbook: Headless) => Certified,
  cap: number,
  timeout: number
): AsyncGenerator<Certified> {
  let next: (() => void) | null = null;
  let running = 0;
  const max = Math.max(1, cap);
  const queue: Settled[] = [];
  const expired = new Error('grader timeout');
  const sleep = () => new Promise<void>(resolve => void (next = resolve));
  const wake = () => {
    next?.();
    next = null;
  };
  const push = (item: Settled) => {
    queue.push(item);
    wake();
  };
  const task = (workbook: Headless) => {
    if (timeout === 0) {
      return correct(workbook);
    }

    let handle: ReturnType<typeof setTimeout>;
    const clear = () => clearTimeout(handle);
    const countdown = new Promise<never>(
      (_, reject) => void (handle = setTimeout(() => reject(expired), timeout))
    );
    return Promise.race([correct(workbook), countdown]).finally(clear);
  };
  const start = (workbook: Headless) => {
    running++;
    void task(workbook)
      .then(grade => push({ ok: true, grade }))
      .catch(error => push({ ok: false, error, workbook }))
      .finally(() => {
        running--;
        wake();
      });
  };

  const take = async (): Promise<Settled | null> => {
    while (!queue.length) {
      if (!running) {
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
    console.warn('grader error', item.workbook.context.path, item.error);
    return recover(item.workbook);
  };

  for await (const workbook of scanner) {
    start(workbook);
    if (queue.length || running >= max) {
      const grade = await emit();
      if (grade) {
        yield grade;
      }
    }
  }

  while (running || queue.length) {
    const grade = await emit();
    if (grade) {
      yield grade;
    }
  }
}
