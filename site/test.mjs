import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { documents } from './documents.mjs';
import { direct, parse } from './markdown.mjs';

const site = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(site);
const output = path.join(site, '_output');

const read = route => readFile(path.join(output, route, 'index.html'), 'utf8');

const descend = async directory =>
  (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async entry => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? descend(target) : [target];
      })
    )
  ).flat();

const apiRoutes = async () =>
  (await descend(path.join(output, 'api')))
    .filter(source => path.basename(source) === 'index.html')
    .map(source => path.relative(output, path.dirname(source)));

const target = (route, href) => {
  const pathname = href.split('#')[0];
  const resolved = path.resolve(output, route, pathname);
  return pathname.endsWith('/') ? path.join(resolved, 'index.html') : resolved;
};

test('Markdown cannot introduce active content', async () => {
  const html = await parse(
    '<style>body{display:none}</style><svg><textarea><img src=x onerror=alert(1)></textarea></svg>',
    () => {}
  );

  assert.doesNotMatch(html, /<(?:img|style|svg|textarea)\b|onerror/i);
  ['//example.com', 'data:text/html,hello', 'javascript:alert(1)'].forEach(
    href => assert.throws(() => direct(href, false), /Unsafe URL/)
  );
  assert.throws(() => direct('mailto:hello@example.com', true), /Unsafe URL/);
  assert.equal(direct('https://example.com', false), 'https://example.com');
  assert.equal(direct('../guide.md', false), null);
});

test('the website has no active content', async () => {
  const api = await apiRoutes();
  const pages = await Promise.all([
    read(''),
    read('docs'),
    ...documents.map(({ slug }) => read(path.join('docs', slug))),
    ...api.map(read)
  ]);

  pages.forEach(page => {
    assert.doesNotMatch(page, /<(?:embed|iframe|object|script|style)\b/i);
    assert.doesNotMatch(page, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(
      page,
      /(?:href|src|srcset)="(?:data:|javascript:|[\\/]{2})/i
    );
  });
});

test('every local website reference has a static destination', async () => {
  const routes = [
    '',
    'docs',
    ...documents.map(({ slug }) => `docs/${slug}`),
    ...(await apiRoutes())
  ];

  await Promise.all(
    routes.map(async route => {
      const page = await read(route);
      const references = [...page.matchAll(/(?:href|src|srcset)="([^"]+)"/g)]
        .map(([, href]) => href)
        .filter(href => !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href));

      await Promise.all(references.map(href => access(target(route, href))));
    })
  );
});

test('canonical guides are rendered', async () => {
  const [authoring, security, design] = await Promise.all([
    read('docs/authoring'),
    read('docs/security'),
    read('docs/design')
  ]);

  assert.match(authoring, /Thinking in question/);
  assert.match(security, /Threat Profile/);
  assert.match(design, /Pull over push/);
});

test('the public API reference is generated', async () => {
  const [overview, browser, node, rubric] = await Promise.all([
    read('api'),
    read('api/browser'),
    read('api/node'),
    read('api/browser/namespaces/rubric')
  ]);

  assert.match(overview, /Correxit API v\d+\.\d+\.\d+/);
  assert.match(browser, /Public browser and JupyterLab API/);
  assert.match(browser, /Rubrics are immutable/);
  assert.match(browser, /discriminated by <code>content<\/code>/);
  assert.match(node, /Browser-free helpers/);
  assert.match(
    rubric,
    /Immutable assignment, cell, reference, and scoring data/
  );
});

test('the JupyterLite testbed is the website demo', async () => {
  await access(path.join(output, 'demo', 'lab', 'index.html'));
  await access(
    path.join(
      output,
      'demo',
      'extensions',
      'correxit',
      'static',
      'remoteEntry.js'
    )
  );

  const config = JSON.parse(
    await readFile(path.join(root, 'lite', 'jupyter_lite_config.json'), 'utf8')
  );
  assert.equal(config.LiteBuildConfig.base_url, '/demo/');
});
