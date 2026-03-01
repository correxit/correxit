import { Button, LabIcon } from '@jupyterlab/ui-components';
import React from 'react';

export const Toggle: React.FC<{
  disabled?: boolean;
  icon: LabIcon;
  title: string;
  toggle?: () => void;
}> = ({ disabled, icon, title, toggle }) => (
  <Button
    className="jp-mod-minimal correxit-toggle"
    disabled={disabled || false}
    onClick={toggle ? event => (event.preventDefault(), toggle()) : undefined}
    title={title}
  >
    <icon.react title={title} tag="span" />
  </Button>
);
