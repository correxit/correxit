import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Sidebar } from './sidebar';

export const Footer: React.FC<{
  commands: CommandRegistry;
}> = ({ commands }) => {
  const { reset } = Sidebar.CommandIDs;
  return (
    <section className="correxit-footer">
      <CommandToolbarButtonComponent commands={commands} id={reset} />
    </section>
  );
};
