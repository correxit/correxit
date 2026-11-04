/** Interleave cold jobs, keeping one pending source read and bounded active jobs. */
export async function* pool<T>(
  source: AsyncIterable<AsyncGenerator<T>>,
  cap: number,
  signal: AbortSignal | null = null
): AsyncGenerator<T> {
  type Job = { iterator: AsyncGenerator<T>; pending: Promise<Ready> };
  type Ready =
    | { type: 'source'; result: IteratorResult<AsyncGenerator<T>> }
    | { type: 'job'; job: Job; result: IteratorResult<T> }
    | { type: 'stop' };
  const iterator = source[Symbol.asyncIterator]();
  const jobs = new Set<Job>();
  let reading: Promise<Ready> | null = null;
  let ended = false;
  let wake: () => void = () => {};
  const stopped = new Promise<Ready>(resolve => {
    wake = () => resolve({ type: 'stop' });
  });
  signal?.addEventListener('abort', wake, { once: true });
  const next = (job: Job) =>
    job.iterator.next().then(result => ({ type: 'job' as const, job, result }));
  try {
    while (jobs.size || (!ended && !signal?.aborted)) {
      if (
        !reading &&
        !ended &&
        !signal?.aborted &&
        jobs.size < Math.max(1, cap)
      )
        reading = iterator.next().then(result => ({ type: 'source', result }));

      const waiting = Array.from(jobs, job => job.pending);
      if (reading && !signal?.aborted) waiting.push(reading);
      if (!signal?.aborted) waiting.push(stopped);
      if (!waiting.length) break;

      const ready = await Promise.race(waiting);
      if (ready.type === 'stop') continue;
      if (ready.type === 'source') {
        reading = null;
        ended = !!ready.result.done;
        if (!ended && !signal?.aborted) {
          const job = { iterator: ready.result.value, pending: null! } as Job;
          jobs.add(job);
          job.pending = next(job);
        }
        continue;
      }

      const { job, result } = ready;
      if (result.done) {
        jobs.delete(job);
      } else {
        yield result.value;
        job.pending = next(job);
      }
    }
  } finally {
    signal?.removeEventListener('abort', wake);
    // Pending next() calls may own a save or a kernel lease. Let them settle
    // before closing their generators; never pull another unit of work here.
    await Promise.allSettled([
      ...Array.from(jobs, async job => {
        await job.pending.catch(() => {});
        await job.iterator.return(undefined);
      }),
      (async () => {
        await reading?.catch(() => {});
        await iterator.return?.();
      })()
    ]);
  }
}
