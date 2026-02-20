import { Workbook } from '..';

type Certified = Workbook.Certified;
type Headless = Workbook.Headless;
type Settled =
  | { ok: true; grade: Certified }
  | { ok: false; error: unknown; workbook: Headless };

/**
 * Grade scanned workbooks with bounded in-flight concurrency.
 */
export async function* grader(
  scanner: AsyncIterable<Headless>,
  correct: (workbook: Headless) => Promise<Certified>,
  limit = 5
): AsyncGenerator<Certified> {
  let resume: (() => void) | null = null;
  let running = 0;
  const max = Math.max(1, limit);
  const queue: Settled[] = [];
  const signal = () => {
    resume?.();
    resume = null;
  };
  const push = (item: Settled) => {
    queue.push(item);
    signal();
  };
  const start = (workbook: Headless) => {
    running++;
    void correct(workbook)
      .then(grade => push({ ok: true, grade }))
      .catch(error => push({ ok: false, error, workbook }))
      .finally(() => {
        running--;
        signal();
      });
  };
  const take = async (): Promise<Settled | null> => {
    while (!queue.length) {
      if (!running) {
        return null;
      }
      await new Promise<void>(resolve => {
        resume = resolve;
      });
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
