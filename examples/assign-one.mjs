#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { Assignment } from '@quantstack/correxit/node';

const usage = () => {
  console.error(
    [
      'Usage:',
      '  node examples/assign-one.mjs template.ipynb --assignee=email --passphrase=secret [--out=file.ipynb]'
    ].join('\n')
  );
  process.exit(1);
};

const argument = name => {
  const prefix = `--${name}=`;
  const value = process.argv.find(arg => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
};

const [template] = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
const assignee = argument('assignee');
const passphrase = argument('passphrase');
const out = argument('out');

if (!template || !assignee || !passphrase) usage();

const source = await readFile(template, 'utf8');
const notebook = JSON.parse(source);
const assigned = await Assignment.assign({ assignee, notebook, passphrase });
const destination = out || assigned.identifier.file;

await writeFile(destination, `${JSON.stringify(assigned.notebook, null, 2)}\n`);
console.log(destination);
