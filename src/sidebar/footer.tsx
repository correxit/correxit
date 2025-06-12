import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Sidebar } from './sidebar';

export const Footer: React.FC<{
  commands: CommandRegistry;
}> = ({ commands }) => {
  const { convert, lock, reset, unlock } = Sidebar.CommandIDs;
  return (
    <section className="correxit-footer">
      <CommandToolbarButtonComponent commands={commands} id={convert} />
      <CommandToolbarButtonComponent commands={commands} id={lock} />
      <CommandToolbarButtonComponent commands={commands} id={unlock} />
      <CommandToolbarButtonComponent commands={commands} id={reset} />
    </section>
  );
};
