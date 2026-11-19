import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { check } from './check-contracts-api.mjs';

const root = resolve(import.meta.dirname, '..');
const script = resolve(root, 'scripts/check-contracts-api.mjs');
const apiReportPath = resolve(root, 'packages/contracts/contracts.api.md');
const dtsPath = resolve(root, 'packages/contracts/lib/index.d.ts');

test('contracts.api.md exists and is up to date', () => {
  assert.equal(existsSync(apiReportPath), true);
  assert.equal(existsSync(dtsPath), true);

  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /API report is up to date/);
});

test('contracts.api.md contains expected public tokens and contracts', () => {
  const content = readFileSync(apiReportPath, 'utf8');

  assert.match(content, /export declare const Collector: Token<Collector>;/);
  assert.match(
    content,
    /export declare const Distributor: Token<Distributor>;/
  );
  assert.match(content, /export declare const Registrar: Token<Registrar>;/);
  assert.match(content, /export declare const Submitter: Token<Submitter>;/);
  assert.match(content, /export declare const Unlocker: Token<Unlocker>;/);
  assert.match(content, /export type Identifier =/);
  assert.match(content, /export type Notebook =/);
  assert.match(content, /export type Secret =/);
  assert.match(content, /export type Registration =/);
  // unlock() must NOT be in Unlocker type
  assert.doesNotMatch(content, /unlock\(/);
  // request() must be present in Unlocker type
  assert.match(
    content,
    /request\(request: Unlocker\.Request\): AsyncIterable<Secret \| null>;/
  );
  // store() must be present in Unlocker type
  assert.match(content, /store\(rubric: string, key: string\): Promise<void>;/);
});

test('packed contracts support standalone providers and reject invalid requests', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'correxit-consumer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const [archive] = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
      {
        cwd: resolve(root, 'packages/contracts'),
        encoding: 'utf8',
        env: { ...process.env, npm_config_cache: resolve(directory, 'cache') }
      }
    )
  );
  const contracts = resolve(directory, 'node_modules/@correxit/contracts');
  mkdirSync(contracts, { recursive: true });
  execFileSync('tar', [
    '-xzf',
    resolve(directory, archive.filename),
    '--strip-components=1',
    '-C',
    contracts
  ]);
  const manifest = JSON.parse(
    readFileSync(resolve(contracts, 'package.json'), 'utf8')
  );
  for (const file of [
    manifest.main,
    manifest.types,
    ...Object.values(manifest.exports['.']),
    'README.md',
    'LICENSE',
    'CHANGELOG.md'
  ]) {
    assert.ok(
      existsSync(resolve(contracts, file)),
      `Missing packed file: ${file}`
    );
  }

  // Only install the public runtime dependency, never the Correxit workspace.
  const require = createRequire(import.meta.url);
  mkdirSync(resolve(directory, 'node_modules/@lumino'));
  symlinkSync(
    dirname(require.resolve('@lumino/coreutils/package.json')),
    resolve(directory, 'node_modules/@lumino/coreutils'),
    'dir'
  );
  const consumer = resolve(directory, 'consumer.ts');
  copyFileSync(resolve(root, 'scripts/tests/contracts.ts'), consumer);
  const program = ts.createProgram([consumer], {
    strict: true,
    noEmit: true,
    types: [],
    lib: ['lib.es2020.d.ts'],
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: file => file,
      getCurrentDirectory: () => directory,
      getNewLine: () => '\n'
    })
  );
  assert.ok(
    program.getSourceFile(realpathSync(resolve(contracts, manifest.types)))
  );
});

const fixture = t => {
  const root = mkdtempSync(resolve(tmpdir(), 'correxit-contracts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = resolve(root, 'packages/contracts');
  mkdirSync(resolve(directory, 'lib'), { recursive: true });
  const write = (file, content) =>
    writeFileSync(resolve(directory, file), content);
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  write('package.json', JSON.stringify({ version: '1.0.0' }));
  write('lib/index.d.ts', 'export type Original = string;\n');
  check({ root, update: true });
  git('add', '.');
  git('commit', '--quiet', '-m', 'Initial contract');
  const base = git('rev-parse', 'HEAD');
  return { root, base, write };
};

test('regenerating the report cannot bypass the version check', t => {
  const { root, base, write } = fixture(t);
  write('lib/index.d.ts', 'export type Changed = number;\n');
  check({ root, update: true });
  assert.throws(() => check({ root, base }), /version 1.0.0 was not increased/);
  write('package.json', JSON.stringify({ version: '0.9.0' }));
  assert.throws(() => check({ root, base }), /was not increased/);
  write('package.json', JSON.stringify({ version: '1.1.0' }));
  assert.doesNotThrow(() => check({ root, base }));
});

test('unchanged APIs do not require a version bump', t => {
  const { root, base } = fixture(t);
  assert.doesNotThrow(() => check({ root, base }));
});

test('stale reports and missing base revisions fail closed', t => {
  const { root, base, write } = fixture(t);
  assert.throws(() => check({ root, base: 'missing-base' }), /Cannot resolve/);
  write('lib/index.d.ts', 'export type Changed = number;\n');
  assert.throws(() => check({ root, base }), /out of date/);
});
