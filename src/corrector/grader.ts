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
 *   the certified result. Errors thrown here are caught and logged.
 * @param limit - Maximum number of workbooks being graded simultaneously.
 *   Values less than 1 are clamped to 1. Defaults to 5.
 *
 * #### Notes
 * `grader` consumes `scanner` lazily: the next workbook is only fetched once a
 * concurrency slot is free, so the kernel pool never grows faster than grading
 * can drain it.
 *
 * Graded workbooks are yielded in completion order (fastest first).
 * Failures are logged and skipped so a bad workbook cannot stall the batch.
 */
export async function* grader(
  scanner: AsyncIterable<Headless>,
  correct: (workbook: Headless) => Promise<Certified>,
  limit = 3
): AsyncGenerator<Certified> {
  let next: (() => void) | null = null;
  let running = 0;
  const max = Math.max(1, limit);
  const queue: Settled[] = [];
  const sleep = () => new Promise<void>(resolve => void (next = resolve));
  const wake = () => {
    next?.();
    next = null;
  };
  const push = (item: Settled) => {
    queue.push(item);
    wake();
  };
  const start = (workbook: Headless) => {
    running++;
    void correct(workbook)
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
    return null;
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
