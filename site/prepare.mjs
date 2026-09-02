import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { documents } from './documents.mjs';

const site = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(site);
const source = path.join(site, '_docs');
const api = path.join(site, '_api');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const repository = pkg.repository.url.replace(/\.git$/, '');

const descend = async directory =>
  (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async entry => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? descend(target) : [target];
      })
    )
  ).flat();

const posix = value => value.split(path.sep).join(path.posix.sep);
const canonical = documents.map(document => ({
  ...document,
  input: document.source,
  output: `${document.slug}.md`
}));
const generated = (await descend(api))
  .filter(input => input.endsWith('.md'))
  .map(input => {
    const relative = posix(path.relative(api, input));
    return {
      input: posix(path.join('site', '_api', relative)),
      output: path.posix.join('api', relative.toLowerCase()),
      source: input
    };
  });
const pages = [
  ...canonical.map(document => ({
    ...document,
    source: path.join(root, document.input)
  })),
  ...generated
];
const routes = new Map(pages.map(({ input, output }) => [input, output]));

const split = value => {
  const index = value.search(/[?#]/);
  return index < 0
    ? { pathname: value, suffix: '' }
    : { pathname: value.slice(0, index), suffix: value.slice(index) };
};

const direct = (href, image) => {
  if (href.startsWith('#') || /^\/(?!\/)/.test(href)) return href;
  if (href.startsWith('//')) throw new Error(`Unsafe URL: ${href}`);

  const scheme = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
  if (!scheme) return null;

  const allowed = image ? ['http', 'https'] : ['http', 'https', 'mailto'];
  if (!allowed.includes(scheme)) throw new Error(`Unsafe URL: ${href}`);
  return href;
};

const rewrite = (markdown, page) =>
  markdown.replace(
    /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)([^)\n]*\))/g,
    (match, opening, destination, closing) => {
      const image = opening.startsWith('!');
      const angled = destination.startsWith('<');
      const href = angled ? destination.slice(1, -1) : destination;
      if (direct(href, image)) return match;

      const { pathname, suffix } = split(href);
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(page.input), pathname)
      );
      const route = routes.get(target);
      const resolved = route
        ? path.posix.relative(path.posix.dirname(page.output), route) || '.'
        : `${repository}/${image ? 'raw' : 'blob'}/main/${target}`;
      const value = `${resolved}${suffix}`;
      return `${opening}${angled ? `<${value}>` : value}${closing}`;
    }
  );

const clean = (markdown, page) => {
  const cleaned =
    page.input === 'README.md'
      ? markdown
          .replace(/^# .+\n+/, '# Overview\n\n')
          .replace(/^\[!\[GitHub Actions status\].+\n+/m, '')
      : page.input === 'CHANGELOG.md'
        ? `# Changelog\n\n${markdown}`
        : markdown;

  if (/<(?:embed|iframe|object|script|style)\b|\son[a-z]+\s*=/i.test(cleaned))
    throw new Error(`Unsafe HTML in ${page.input}`);
  const rewritten = rewrite(cleaned, page);
  if (!page.input.startsWith('site/_api/')) return rewritten;

  const seen = new Map();
  return rewritten.replace(/^(#{1,6}) (.+)$/gm, (heading, level, title) => {
    const stem = title
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[`~!*_[\](){}<>]/g, '')
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const count = seen.get(stem) ?? 0;
    seen.set(stem, count + 1);
    return count ? `${heading} { #${stem}-${count} }` : heading;
  });
};

await rm(source, { recursive: true, force: true });
await mkdir(path.join(source, 'assets', 'stylesheets'), { recursive: true });
await Promise.all(
  ['light', 'dark'].map(mode =>
    cp(
      path.join(root, 'style', 'brand', `correxit-mark-on-${mode}.svg`),
      path.join(source, 'assets', `correxit-${mode}.svg`)
    )
  )
);
await cp(
  path.join(site, 'style.css'),
  path.join(source, 'assets', 'stylesheets', 'correxit.css')
);
await cp(path.join(site, 'index.md'), path.join(source, 'index.md'));
await mkdir(path.join(source, 'demo', 'notebooks'), { recursive: true });
await writeFile(
  path.join(source, 'demo', 'notebooks', 'index.html'),
  '<!doctype html><title>Correxit demo</title>\n'
);

await Promise.all(
  pages.map(async page => {
    const output = path.join(source, page.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, clean(await readFile(page.source, 'utf8'), page));
  })
);
