import { CommandRegistry } from '@lumino/commands';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { useEffect, useState } from 'react';

/**
 * A utility hook for collecting the output of an async iterable command.
 *
 * @param commands - the command registry.
 * @param id - the command ID.
 * @param args - the (optional) command args.
 * @returns a tuple, the collected list and whether iteration is complete.
 *
 * #### Notes
 * This utility will work with any command that returns an async iterator,
 * generator, or any other iterable. The collected list is updated with every
 * yield/iteration and allows a component to display the collection as it grows.
 *
 * For performance, collected items should be rendered by a memoized component.
 *
 * If the command `id` is not found, e.g., `id: ""`, the collection is empty.
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
      setList([]);
      setIdle(false);
      for await (const item of await (stream || [])) {
        if (interrupted) {
          return;
        }
        setList(list => [...list, item]);
      }
      setIdle(true);
    })(commands.hasCommand(id) ? commands.execute(id, args) : void 0);
    return () => void (interrupted = true);
  }, [id, JSON.stringify(args)]);
  return [list, idle];
}
