import { CommandRegistry } from '@lumino/commands';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { Throttler } from '@lumino/polling';
import { useEffect, useState } from 'react';

type State<T> = { idle: boolean; list: T[]; snapshot: string | null; };

/**
 * Executes a command that yields an async iterable and streams its results into
 * a state array in a component.
 *
 * @template T - the type of items yielded by the command.
 * @param commands - the application command registry.
 * @param id - the ID of the command to execute.
 * @param args - the arguments passed to the command.
 * @returns a tuple containing the accumulating list of items and an `idle` flag
 * indicating whether the command has completed.
 *
 * #### Notes
 * This hook bridges the gap between imperative async generators and declarative
 * React UI, enabling real-time visualization of "streaming" data. The consuming
 * component should use memoization to render efficiently.
 *
 * Command streams restart when `commands`, `id`, or serialized `args` changes.
 * Each invocation receives its JSON argument snapshot.
 * Cleanup marks the prior stream interrupted and drops subsequent emissions.
 *
 * State updates are buffered and throttled to ~60fps (16ms).
 */
export function useCommand<T>(
  commands: CommandRegistry,
  id: string,
  args?: ReadonlyPartialJSONObject
): [T[], boolean] {
  const snapshot = JSON.stringify(args) ?? null;
  const [state, setState] = useState<State<T>>({ idle: false, list: [], snapshot });
  useEffect((interrupted = false) => {
    const args: ReadonlyPartialJSONObject | undefined =
      snapshot === null ? undefined : JSON.parse(snapshot);
    (async (stream?: Promise<AsyncIterable<T> | Iterable<T>>) => {
      const buffer: T[] = [];
      const flush = () => {
        if (!interrupted && buffer.length) {
          const chunk = buffer.slice();
          buffer.length = 0;
          setState(({ list }) => ({ idle: false, list: [...list, ...chunk], snapshot }));
        }
      };
      const throttler = new Throttler(flush, { limit: 16 });
      setState({ idle: false, list: [], snapshot });
      let painted = performance.now();
      try {
        const iterable = await (stream || []);
        if (interrupted) {
          if (Symbol.asyncIterator in iterable)
            await iterable[Symbol.asyncIterator]().return?.();
          return;
        }
        for await (const item of iterable) {
          if (interrupted) return;
          buffer.push(item);
          void throttler.invoke();
          if (performance.now() - painted >= 16) {
            flush();
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            if (interrupted) return;
            painted = performance.now();
          }
        }
        flush();
      } catch (error) {
        console.warn('Command stream failed', id);
      } finally {
        throttler.dispose();
        if (!interrupted) setState(({ list }) => ({ idle: true, list, snapshot }));
      }
    })(commands.hasCommand(id) ? commands.execute(id, args) : undefined);
    return () => void (interrupted = true);
  }, [commands, id, snapshot]);
  return state.snapshot === snapshot ? [state.list, state.idle] : [[], false];
}
