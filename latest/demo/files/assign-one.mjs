#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Assignment } from 'correxit/node';

const usage = () => {
  console.error(
    [
      'Usage:',
      '  node examples/assign-one.mjs template.ipynb --assignee=email --passphrase=secret [--out=dir/]'
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
const assigned = await Assignment.assign({
  assignee,
  key: null,
  notebook,
  passphrase
});

const templateDir = dirname(template) || '.';
const outputDir = out || assigned.identifier.file.replace(/\.ipynb$/, '');
await mkdir(outputDir, { recursive: true });

const destination = join(outputDir, assigned.identifier.file);
await writeFile(destination, `${JSON.stringify(assigned.notebook, null, 2)}\n`);
console.log(destination);

for (const name of assigned.resources ?? []) {
  await copyFile(join(templateDir, name), join(outputDir, name));
  console.log(join(outputDir, name));
}
