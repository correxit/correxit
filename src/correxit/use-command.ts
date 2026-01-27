import { CommandRegistry } from '@lumino/commands';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { Throttler } from '@lumino/polling';
import { useEffect, useState } from 'react';

/**
 * Executes a command that yields an async iterable and streams its results into
 * a state array in a component.
 *
 * @template T - The type of items yielded by the command.
 * @param commands - The application command registry.
 * @param id - The ID of the command to execute.
 * @param args - The arguments passed to the command.
 * @returns A tuple containing the accumulating list of items and an `idle` flag
 * indicating whether the command has completed.
 *
 * #### Notes
 * This hook bridges the gap between imperative async generators and declarative
 * React UI, enabling real-time visualization of "streaming" data.
 *
 * State updates are buffered and throttled to ~60fps (16ms).
 *
 * Ideally, the consuming component should use memoization to render the list
 * efficiently.
 */
export function useCommand<T>(
  commands: CommandRegistry,
  id: string,
  args?: ReadonlyPartialJSONObject
): [T[], boolean] {
  const [list, setList] = useState([] as T[]);
  const [idle, setIdle] = useState(true);
  useEffect((interrupted = false) => {
    (async (stream?: Promise<AsyncIterable<T> | Iterable<T>>) => {
      const buffer: T[] = [];
      const flush = () => {
        if (buffer.length) {
          const chunk = [...buffer];
          buffer.length = 0;
          setList(prev => [...prev, ...chunk]);
        }
      };
      const throttler = new Throttler(flush, { limit: 16 });
      setList([]);
      setIdle(false);
      for await (const item of await (stream || [])) {
        if (interrupted) {
          return void throttler.dispose();
        }
        buffer.push(item);
        void throttler.invoke();
      }
      throttler.dispose();
      flush();
      setIdle(true);
    })(commands.hasCommand(id) ? commands.execute(id, args) : void 0);
    return () => void (interrupted = true);
  }, [id, JSON.stringify(args)]);
  return [list, idle];
}
