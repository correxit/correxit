import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { documents } from './documents.mjs';

const site = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(site);
const api = path.join(site, '_api');
const output = path.join(site, '_output');
const lite = path.join(root, 'lite', '_output');
const repository = process.env.GITHUB_REPOSITORY
  ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
  : 'https://github.com/QuantStack/correxit';
const routes = new Map(documents.map(({ slug, source }) => [source, slug]));

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
const apiRoute = source => {
  const relative = posix(path.relative(api, source)).replace(/\.md$/, '');
  return (
    relative === 'index' ? '' : relative.replace(/\/index$/, '')
  ).toLowerCase();
};

const apiPages = await Promise.all(
  (await descend(api))
    .filter(source => source.endsWith('.md'))
    .map(async source => {
      const markdown = await readFile(source, 'utf8');
      const heading = markdown.match(/^# (.+)$/m);
      if (!heading) throw new Error(`API page has no title: ${source}`);
      return {
        markdown,
        route: apiRoute(source),
        source: posix(path.relative(api, source)),
        title: heading[1]
      };
    })
);
const apiRoutes = new Map(apiPages.map(({ route, source }) => [source, route]));

const escape = value =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const policy = {
  allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img'],
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    code: ['class']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false
};
const sanitize = html => sanitizeHtml(html, policy);

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

const resolveApi = (document, href) => {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(href)) return href;

  const { pathname, hash } = split(href);
  if (!pathname.endsWith('.md')) return href;

  const source = path.posix.normalize(
    path.posix.join(path.posix.dirname(document.source), pathname)
  );
  if (!apiRoutes.has(source))
    throw new Error(`API link has no generated page: ${source}`);

  const route = apiRoutes.get(source);
  const current = path.posix.join('api', document.route);
  const target = path.posix.join('api', route);
  const relative = path.posix.relative(current, target) || '.';
  return `${relative}/${hash}`;
};

const clean = markdown =>
  markdown
    .replace(/^# .+\n+/, '')
    .replace(/^\[!\[Github Actions Status\].+\n+/m, '');

const cleanApi = markdown => {
  const heading = markdown.match(/^# .+\n+/m);
  return heading
    ? markdown.slice((heading.index ?? 0) + heading[0].length)
    : markdown;
};

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
  return headings(sanitize(await parser.parse(clean(markdown))));
};

const renderApi = async document => {
  const parser = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link') token.href = resolveApi(document, token.href);
    }
  });
  return headings(sanitize(await parser.parse(cleanApi(document.markdown))));
};

const navigation = (current, base = '../') => `
  <nav class="docs-nav" aria-label="Documentation">
    <strong>Documentation</strong>
    <ul>
      ${documents
        .map(
          ({ slug, title }) => `
        <li><a href="${base}${slug}/"${
          slug === current ? ' aria-current="page"' : ''
        }>${escape(title)}</a></li>`
        )
        .join('')}
        <li><a href="${base}../api/">API Reference</a></li>
    </ul>
  </nav>`;

const apiHref = (current, target) => {
  const from = path.posix.join('api', current);
  const to = path.posix.join('api', target);
  return `${path.posix.relative(from, to) || '.'}/`;
};

const apiNavigation = current => {
  const links = [
    ['', 'Overview'],
    ['browser', 'Browser'],
    ['node', 'Node'],
    ['browser/namespaces/assignment', 'Assignment'],
    ['browser/namespaces/correxit', 'Correxit'],
    ['browser/namespaces/rubric', 'Rubric'],
    ['browser/namespaces/workbook', 'Workbook']
  ];
  return `
  <nav class="docs-nav" aria-label="API Reference">
    <strong>API Reference</strong>
    <ul>
      ${links
        .map(
          ([route, title]) => `
        <li><a href="${apiHref(current, route)}"${
          route === current ? ' aria-current="page"' : ''
        }>${title}</a></li>`
        )
        .join('')}
    </ul>
  </nav>`;
};

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
        <a href="${base}api/">API</a>
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

const apiPage = async document =>
  page({
    title: document.route ? document.title : 'API Reference',
    description: "Generated reference for Correxit's public APIs.",
    base: '../'.repeat(
      1 + (document.route ? document.route.split('/').length : 0)
    ),
    body: `<div class="docs">
      ${apiNavigation(document.route)}
      <main class="document api-document">
        <header class="document-header">
          <h1>${escape(document.route ? document.title : 'API Reference')}</h1>
          <p>${
            document.route ? '' : `${escape(document.title)}. `
          }Generated from Correxit's public TypeScript declarations.</p>
        </header>
        <article class="prose">${await renderApi(document)}</article>
      </main>
    </div>`
  });

const indexPage = page({
  title: 'Documentation',
  description: 'Correxit documentation built from the repository guides.',
  base: '../',
  body: `<div class="docs">
    ${navigation(null, '')}
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

await Promise.all(
  apiPages.map(async document => {
    const directory = path.join(output, 'api', document.route);
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, 'index.html'),
      await apiPage(document)
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
  ${apiPages
    .map(
      ({ route }) =>
        `<url><loc>https://correx.it/api/${route ? `${route}/` : ''}</loc></url>`
    )
    .join('\n  ')}
  <url><loc>https://correx.it/demo/lab/</loc></url>
</urlset>
`
);
