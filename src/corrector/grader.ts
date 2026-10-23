import { Workbook } from '..';
import { pool } from './pool';

type Certified = Workbook.Certified;
type Grade = Workbook.Grade;
type Headless = Workbook.Headless;

export type Actions = {
  correct: (workbook: Headless) => Promise<Certified>;
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
 *   - `correct`: authenticate, then reuse a trusted report or execute grading.
 *   - `recover`: fallback result for failures after retries.
 * @param cap - Maximum number of workbooks being graded simultaneously.
 *   Values less than 1 are clamped to 1.
 * @param retries - How many times to retry a workbook where `correct` throws
 *   before giving up and calling `recover`. Workbooks that return
 *   `resolved: false` are not retried. Defaults to `0`.
 *
 * #### Notes
 * `grade()` consumes `scanner` lazily: the next workbook is only fetched once a
 * concurrency slot is free, so the kernel pool never grows faster than grading
 * can drain it.
 *
 * Timeouts are not managed here, the kernel lease deadline (`kernels.timeout`)
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
  retries: number = 0,
  signal: AbortSignal | null = null
): AsyncGenerator<Result> {
  const jobs = async function* () {
    for await (const workbook of scanner) {
      yield (async function* (): AsyncGenerator<Result> {
        for (let attempt = 0; ; attempt++) {
          try {
            const certified = await actions.correct(workbook);
            yield { ok: true, certified };
            return;
          } catch {
            if (attempt < retries && !signal?.aborted) continue;
            console.warn('grader error', workbook.context.path);
            yield actions.recover(workbook);
            return;
          }
        }
      })();
    }
  };
  yield* pool(jobs(), cap, signal);
}
