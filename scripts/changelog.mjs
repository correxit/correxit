import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const run = (command, ...args) =>
  execFileSync(command, args, { encoding: 'utf8' }).trim();

const entries = markdown =>
  Array.from(
    markdown.matchAll(/^<!-- (?:START|END) GENERATED CHANGELOG: (.+) -->$/gm),
    ([, version]) => version
  );

export const update = (markdown, version, notes) => {
  const start = `<!-- START GENERATED CHANGELOG: ${version} -->`;
  const end = `<!-- END GENERATED CHANGELOG: ${version} -->`;
  const block = `${start}\n\n${notes.trim()}\n\n${end}`;
  const first = markdown.indexOf(start);
  const last = markdown.indexOf(end);

  if (first !== -1 || last !== -1) {
    if (first === -1 || last < first)
      throw new Error('Incomplete generated changelog block.');
    return markdown.slice(0, first) + block + markdown.slice(last + end.length);
  }

  const heading = `# ${version}\n`;
  if (markdown.startsWith(heading))
    return `${heading}\n${block}\n\n${markdown.slice(heading.length).trimStart()}`;
  return `${heading}\n${block}\n\n${markdown}`;
};

export const generate = base => {
  if (!base) throw new Error('Pass the release PR base commit.');
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  const { version: previous } = JSON.parse(
    run('git', 'show', `${base}:package.json`)
  );
  const markdown = readFileSync('CHANGELOG.md', 'utf8');
  const history = new Set(entries(run('git', 'show', `${base}:CHANGELOG.md`)));
  const obsolete = entries(markdown).find(
    entry => !history.has(entry) && (version === previous || entry !== version)
  );
  if (obsolete)
    throw new Error(
      `Generated changelog entry for ${obsolete} is obsolete for package version ${version}. ` +
        'Remove or rename its heading and generated block in CHANGELOG.md, preserving any handwritten notes.'
    );
  if (version === previous) return;

  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(version) || !stable.test(previous))
    throw new Error('Changelog generation requires stable package versions.');
  const comparison = version
    .split('.')
    .map((part, index) => Number(part) - Number(previous.split('.')[index]))
    .find(difference => difference !== 0);
  if (!(comparison > 0)) throw new Error('The release version must increase.');

  const tag = `v${version}`;
  const prior = `v${previous}`;
  if (run('git', 'tag', '--list', tag))
    throw new Error(`Refusing to change notes for existing tag ${tag}.`);
  run('git', 'merge-base', '--is-ancestor', `refs/tags/${prior}`, 'HEAD');

  const { body } = JSON.parse(
    run(
      'gh',
      'api',
      '--method',
      'POST',
      'repos/{owner}/{repo}/releases/generate-notes',
      '-f',
      `tag_name=${tag}`,
      '-f',
      `previous_tag_name=${prior}`,
      '-f',
      `target_commitish=${run('git', 'rev-parse', 'HEAD')}`
    )
  );
  if (typeof body !== 'string' || !body.trim())
    throw new Error('GitHub returned no release notes.');
  writeFileSync('CHANGELOG.md', update(markdown, version, body));
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  generate(process.argv[2]);
