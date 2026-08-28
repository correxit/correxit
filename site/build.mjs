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
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Mustache from 'mustache';
import { documents } from './documents.mjs';
import { direct, parse } from './markdown.mjs';

const site = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(site);
const require = createRequire(import.meta.url);
const api = path.join(site, '_api');
const output = path.join(site, '_output');
const lite = path.join(root, 'lite', '_output');
const pico = require.resolve('@picocss/pico/css/pico.classless.min.css');
const license = require.resolve('@picocss/pico/LICENSE.md');
const github = process.env.GITHUB_REPOSITORY;
const repository =
  github && /^[\w.-]+\/[\w.-]+$/.test(github)
    ? `https://github.com/${github}`
    : 'https://github.com/QuantStack/correxit';
const routes = new Map(documents.map(({ slug, source }) => [source, slug]));
const templates = Object.fromEntries(
  await Promise.all(
    ['document', 'listing', 'navigation', 'page'].map(async name => [
      name,
      await readFile(path.join(site, 'templates', `${name}.html`), 'utf8')
    ])
  )
);
const template = (name, view) =>
  Mustache.render(templates[name], view, {
    navigation: templates.navigation
  });

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

const split = href => {
  const index = href.indexOf('#');
  return index < 0
    ? { pathname: href, hash: '' }
    : { pathname: href.slice(0, index), hash: href.slice(index) };
};

const resolve = (document, href, image) => {
  const absolute = direct(href, image);
  if (absolute) return absolute;

  const { pathname, hash } = split(href);
  const source = path.posix.normalize(
    path.posix.join(path.posix.dirname(document.source), pathname)
  );
  const slug = routes.get(source);

  if (slug) return `../${slug}/${hash}`;
  return `${repository}/${image ? 'raw' : 'blob'}/main/${source}${hash}`;
};

const resolveApi = (document, href) => {
  const absolute = direct(href, false);
  if (absolute) return absolute;

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
  return headings(
    await parse(clean(markdown), token => {
      if (token.type === 'link')
        token.href = resolve(document, token.href, false);
      if (token.type === 'image')
        token.href = resolve(document, token.href, true);
    })
  );
};

const renderApi = async document =>
  headings(
    await parse(cleanApi(document.markdown), token => {
      if (token.type === 'link') token.href = resolveApi(document, token.href);
    })
  );

const navigation = (current, base = '../') => ({
  label: 'Documentation',
  links: [
    ...documents.map(({ slug, title }) => ({
      current: slug === current,
      href: `${base}${slug}/`,
      title
    })),
    { current: false, href: `${base}../api/`, title: 'API Reference' }
  ]
});

const apiHref = (current, target) => {
  const from = path.posix.join('api', current);
  const to = path.posix.join('api', target);
  return `${path.posix.relative(from, to) || '.'}/`;
};

const apiNavigation = current => ({
  label: 'API Reference',
  links: [
    ['', 'Overview'],
    ['browser', 'Browser'],
    ['node', 'Node'],
    ['browser/namespaces/assignment', 'Assignment'],
    ['browser/namespaces/correxit', 'Correxit'],
    ['browser/namespaces/rubric', 'Rubric'],
    ['browser/namespaces/workbook', 'Workbook']
  ].map(([route, title]) => ({
    current: route === current,
    href: apiHref(current, route),
    title
  }))
});

const page = ({ title, description, body, base = '../../', suffix = true }) =>
  template('page', { base, body, description, repository, suffix, title });

const documentPage = async document =>
  page({
    title: document.title,
    description: document.description,
    body: template('document', {
      classes: 'document',
      content: await render(document),
      navigation: navigation(document.slug),
      summary: document.description,
      title: document.title
    })
  });

const apiPage = async document =>
  page({
    title: document.route ? document.title : 'API Reference',
    description: "Generated reference for Correxit's public APIs.",
    base: '../'.repeat(
      1 + (document.route ? document.route.split('/').length : 0)
    ),
    body: template('document', {
      classes: 'document api-document',
      content: await renderApi(document),
      navigation: apiNavigation(document.route),
      summary: `${document.route ? '' : `${document.title}. `}Generated from Correxit's public TypeScript declarations.`,
      title: document.route ? document.title : 'API Reference'
    })
  });

const indexPage = page({
  title: 'Documentation',
  description: 'Correxit documentation built from the repository guides.',
  base: '../',
  body: template('listing', {
    documents,
    navigation: navigation(null, '')
  })
});

await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
await Promise.all(
  ['light', 'dark'].map(mode =>
    cp(
      path.join(root, 'style', 'brand', `correxit-mark-on-${mode}.svg`),
      path.join(output, 'assets', `correxit-${mode}.svg`)
    )
  )
);
await cp(pico, path.join(output, 'pico.css'));
await mkdir(path.join(output, 'licenses'));
await cp(license, path.join(output, 'licenses', 'pico.txt'));
await cp(path.join(site, 'style.css'), path.join(output, 'style.css'));

const home = page({
  title: 'Correxit',
  description:
    'Correxit is a kernel-agnostic Jupyter extension for grading notebooks.',
  base: './',
  body: await readFile(path.join(site, 'index.html'), 'utf8'),
  suffix: false
});
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

await Promise.all(
  ['lab', 'notebooks'].map(app => access(path.join(lite, app, 'index.html')))
);
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
  <url><loc>https://correx.it/demo/notebooks/index.html?path=chinook.ipynb</loc></url>
</urlset>
`
);
