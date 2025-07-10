import { CommandToolbarButtonComponent } from '@jupyterlab/ui-components';
import { CommandRegistry } from '@lumino/commands';
import React from 'react';
import { Correxit } from '../correxit';

export const Footer: React.FC<{
  commands: CommandRegistry;
}> = ({ commands }) => {
  const { reset } = Correxit.CommandIDs;
  return (
    <section className="correxit-footer">
      <CommandToolbarButtonComponent commands={commands} id={reset} />
    </section>
  );
};
