import {
  access,
  cp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import { documents } from './documents.mjs';

const site = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(site);
const output = path.join(site, '_output');
const lite = path.join(root, 'lite', '_output');
const repository = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/QuantStack/correxit';
const routes = new Map(documents.map(({ slug, source }) => [source, slug]));

const escape = value =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const split = href => {
  const index = href.indexOf('#');
  return index < 0
    ? { pathname: href, hash: '' }
    : { pathname: href.slice(0, index), hash: href.slice(index) };
};

const resolve = (document, href, image) => {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return href;

  const { pathname, hash } = split(href);
  const source = path.posix.normalize(
    path.posix.join(path.posix.dirname(document.source), pathname)
  );
  const slug = routes.get(source);

  if (slug) return `../${slug}/${hash}`;
  return `${repository}/${image ? 'raw' : 'blob'}/main/${source}${hash}`;
};

const clean = markdown =>
  markdown
    .replace(/^# .+\n+/, '')
    .replace(/^\[!\[Github Actions Status\].+\n+/m, '');

const slugify = value =>
  value
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, ' ')
    .toLowerCase()
    .replace(/[^a-z\d]+/g, '-')
    .replace(/^-|-$/g, '');

const headings = html => {
  const seen = new Map();
  return html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_, level, text) => {
    const stem = slugify(text) || 'section';
    const count = (seen.get(stem) ?? 0) + 1;
    seen.set(stem, count);
    const id = count === 1 ? stem : `${stem}-${count}`;
    return `<h${level} id="${id}">${text}</h${level}>`;
  });
};

const render = async document => {
  const markdown = await readFile(path.join(root, document.source), 'utf8');
  const parser = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link')
        token.href = resolve(document, token.href, false);
      if (token.type === 'image')
        token.href = resolve(document, token.href, true);
    }
  });
  return headings(await parser.parse(clean(markdown)));
};

const navigation = current => `
  <nav class="docs-nav" aria-label="Documentation">
    <strong>Documentation</strong>
    <ul>
      ${documents
        .map(
          ({ slug, title }) => `
        <li><a href="../${slug}/"${
          slug === current ? ' aria-current="page"' : ''
        }>${escape(title)}</a></li>`
        )
        .join('')}
    </ul>
  </nav>`;

const page = ({ title, description, body, base = '../../' }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escape(description)}">
    <title>${escape(title)} · Correxit</title>
    <link rel="icon" href="${base}assets/correxit.svg" type="image/svg+xml">
    <link rel="stylesheet" href="${base}style.css">
  </head>
  <body>
    <header class="site-header">
      <a class="brand" href="${base}" aria-label="Correxit home">
        <img src="${base}assets/correxit.svg" alt="" width="32" height="32">
        <span>Correxit</span>
      </a>
      <nav aria-label="Primary navigation">
        <a href="${base}docs/">Documentation</a>
        <a href="${base}demo/lab/">Demo</a>
        <a href="${repository}">GitHub</a>
      </nav>
    </header>
    ${body}
    <footer><span>Correxit</span><a href="${repository}">Source</a></footer>
  </body>
</html>
`;

const documentPage = async document =>
  page({
    title: document.title,
    description: document.description,
    body: `<div class="docs">
      ${navigation(document.slug)}
      <main class="document">
        <header class="document-header">
          <h1>${escape(document.title)}</h1>
          <p>${escape(document.description)}</p>
        </header>
        <article class="prose">${await render(document)}</article>
      </main>
    </div>`
  });

const indexPage = page({
  title: 'Documentation',
  description: 'Correxit documentation built from the repository guides.',
  base: '../',
  body: `<div class="docs">
    <nav class="docs-nav" aria-label="Documentation">
      <strong>Documentation</strong>
    </nav>
    <main class="document">
      <header class="document-header">
        <h1>Documentation</h1>
        <p>Built directly from the Markdown guides in the Correxit repository.</p>
      </header>
      <ul class="document-list">
        ${documents
          .map(
            ({ slug, title, description, audience }) => `
          <li>
            <h2><a href="${slug}/">${escape(title)}</a></h2>
            <p>${escape(description)} ${escape(audience)}.</p>
          </li>`
          )
          .join('')}
      </ul>
    </main>
  </div>`
});

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await cp(
  path.join(root, 'style', 'brand', 'correxit-mark-on-light.svg'),
  path.join(output, 'assets', 'correxit.svg')
);
await cp(path.join(site, 'style.css'), path.join(output, 'style.css'));

const home = (await readFile(path.join(site, 'index.html'), 'utf8')).replaceAll(
  '{{repository}}',
  repository
);
await writeFile(path.join(output, 'index.html'), home);
await mkdir(path.join(output, 'docs'), { recursive: true });
await writeFile(path.join(output, 'docs', 'index.html'), indexPage);

await Promise.all(
  documents.map(async document => {
    const directory = path.join(output, 'docs', document.slug);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'index.html'),
      await documentPage(document)
    );
  })
);

await access(path.join(lite, 'lab', 'index.html'));
await symlink(path.relative(output, lite), path.join(output, 'demo'), 'dir');

await writeFile(
  path.join(output, 'robots.txt'),
  'User-agent: *\nAllow: /\nSitemap: https://correx.it/sitemap.xml\n'
);
await writeFile(
  path.join(output, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://correx.it/</loc></url>
  <url><loc>https://correx.it/docs/</loc></url>
  ${documents
    .map(({ slug }) => `<url><loc>https://correx.it/docs/${slug}/</loc></url>`)
    .join('\n  ')}
  <url><loc>https://correx.it/demo/lab/</loc></url>
</urlset>
`
);
