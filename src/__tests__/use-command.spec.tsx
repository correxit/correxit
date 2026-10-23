import { CommandRegistry } from '@lumino/commands';
import React, { act } from 'react';
import { useCommand } from '../correxit/use-command';

const { createRoot } = jest.requireActual('react-dom/client');

describe('command stream rendering pauses', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  });

  it.each([false, true])(
    'respects cleanup before the next pull: %s',
    async canceled => {
      const commands = new CommandRegistry();
      const started = jest.fn();
      const closed = jest.fn();
      commands.addCommand('distribute', {
        execute: () =>
          (async function* () {
            try {
              jest.advanceTimersByTime(16);
              yield 'separator';
              started();
              yield 'distributed';
            } finally {
              closed();
            }
          })()
      });
      const Probe = () => {
        useCommand(commands, 'distribute');
        return null;
      };
      const root = createRoot(document.createElement('div'));
      try {
        await act(async () => root.render(<Probe />));
        expect(started).not.toHaveBeenCalled();
        expect(closed).not.toHaveBeenCalled();
        if (canceled) act(() => root.unmount());
        await act(async () => jest.advanceTimersByTimeAsync(0));
        expect(started).toHaveBeenCalledTimes(canceled ? 0 : 1);
        expect(closed).toHaveBeenCalledTimes(1);
      } finally {
        act(() => root.unmount());
      }
    }
  );
});
