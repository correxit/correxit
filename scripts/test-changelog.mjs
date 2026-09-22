import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { update } from './changelog.mjs';

const script = fileURLToPath(new URL('./changelog.mjs', import.meta.url));
const history = '# 2.0.1\n\nPrevious release notes.\n';
const notes = "## What's Changed\n* Fix grading in PR #123\n";

const fixture = t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'correxit-changelog-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (name, content) =>
    writeFileSync(path.join(directory, name), content);
  const read = name => readFileSync(path.join(directory, name), 'utf8');
  const git = (...args) =>
    execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
  git('init', '--quiet');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  write('package.json', JSON.stringify({ version: '2.0.1' }));
  write('CHANGELOG.md', history);
  git('add', 'package.json', 'CHANGELOG.md');
  git('commit', '--quiet', '-m', 'Previous release');
  git('tag', 'v2.0.1');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(
    path.join(directory, 'gh'),
    `#!/usr/bin/env node
require('node:fs').writeFileSync('request.json', JSON.stringify(process.argv.slice(2)));
if (process.env.FAIL_NOTES) process.exit(1);
console.log(JSON.stringify({ body: process.env.NOTES }));
`,
    { mode: 0o755 }
  );
  const run = (env = {}) =>
    spawnSync(process.execPath, [script, base], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        NOTES: notes,
        ...env
      }
    });
  return { directory, write, read, git, base, run };
};

test('ordinary PRs leave the changelog untouched without calling GitHub', t => {
  const { directory, read, run } = fixture(t);
  assert.equal(run().status, 0);
  assert.equal(read('CHANGELOG.md'), history);
  assert.equal(existsSync(path.join(directory, 'request.json')), false);
});

test('release notes use the exact tag range and preserve curated notes on reruns', t => {
  const { write, read, git, run } = fixture(t);
  write('package.json', JSON.stringify({ version: '2.0.2' }));
  write(
    'CHANGELOG.md',
    `# 2.0.2\n\nKeep this compatibility warning.\n\n${history}`
  );
  git('add', 'package.json', 'CHANGELOG.md');
  git('commit', '--quiet', '-m', 'Prepare patch release');
  assert.equal(run().status, 0);
  assert.deepEqual(JSON.parse(read('request.json')), [
    'api',
    '--method',
    'POST',
    'repos/{owner}/{repo}/releases/generate-notes',
    '-f',
    'tag_name=v2.0.2',
    '-f',
    'previous_tag_name=v2.0.1',
    '-f',
    `target_commitish=${git('rev-parse', 'HEAD')}`
  ]);
  const generated = read('CHANGELOG.md');
  assert.equal(generated.match(/^# 2\.0\.2$/gm).length, 1);
  assert.ok(generated.includes(notes.trim()));
  assert.ok(
    generated.endsWith(`Keep this compatibility warning.\n\n${history}`)
  );
  assert.equal(run().status, 0);
  assert.equal(read('CHANGELOG.md'), generated);
  assert.equal(run({ NOTES: 'Updated PR list.' }).status, 0);
  assert.equal(
    read('CHANGELOG.md'),
    generated.replace(notes.trim(), 'Updated PR list.')
  );
});

test('new release entries preserve the complete existing history', () => {
  const generated = update(history, '2.0.2', notes);
  assert.ok(generated.startsWith('# 2.0.2\n'));
  assert.ok(generated.endsWith(history));
});

test('broken markers fail without silently duplicating an entry', () => {
  assert.throws(
    () =>
      update(
        '# 2.0.2\n<!-- START GENERATED CHANGELOG: 2.0.2 -->',
        '2.0.2',
        notes
      ),
    /Incomplete/
  );
});

for (const scenario of [
  'prerelease',
  'downgrade',
  'missing tag',
  'existing tag',
  'API failure',
  'empty notes'
]) {
  test(`${scenario} leaves the changelog untouched`, t => {
    const { write, read, git, run } = fixture(t);
    write(
      'package.json',
      JSON.stringify({
        version:
          scenario === 'prerelease'
            ? '2.0.2-rc.1'
            : scenario === 'downgrade'
              ? '1.9.0'
              : '2.0.2'
      })
    );
    if (scenario === 'missing tag') git('tag', '-d', 'v2.0.1');
    if (scenario === 'existing tag') git('tag', 'v2.0.2');
    const result = run({
      FAIL_NOTES: scenario === 'API failure' ? '1' : '',
      NOTES: scenario === 'empty notes' ? '' : notes
    });
    assert.notEqual(result.status, 0);
    assert.equal(read('CHANGELOG.md'), history);
  });
}
