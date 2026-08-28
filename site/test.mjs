import assert from 'node:assert/strict';
import { access, lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { documents } from './documents.mjs';

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
  const pathname = decodeURI(href.split(/[?#]/)[0]);
  const resolved = path.resolve(output, route, pathname);
  return pathname.endsWith('/') ? path.join(resolved, 'index.html') : resolved;
};

test('canonical Markdown cannot introduce executable content', async () => {
  const markdown = await Promise.all(
    documents.map(({ source }) => readFile(path.join(root, source), 'utf8'))
  );

  markdown.forEach(source => {
    assert.doesNotMatch(source, /<(?:embed|iframe|object|script|style)\b/i);
    assert.doesNotMatch(source, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(source, /\]\((?:data:|javascript:|[\\/]{2})/i);
  });
});

test('the generated website is self-contained', async () => {
  const api = await apiRoutes();
  const pages = await Promise.all([
    read(''),
    ...documents.map(({ slug }) => read(slug)),
    ...api.map(read)
  ]);

  pages.forEach(page => {
    assert.doesNotMatch(page, /<(?:embed|iframe|object)\b/i);
    assert.doesNotMatch(page, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(page, /(?:href|src)="(?:data:|javascript:|[\\/]{2})/i);
    assert.doesNotMatch(page, /<script[^>]+src="https?:/i);
    assert.doesNotMatch(page, /<link[^>]+rel="stylesheet"[^>]+href="https?:/i);
  });
});

test('every local website reference has a static destination', async () => {
  const routes = [
    '',
    ...documents.map(({ slug }) => slug),
    ...(await apiRoutes())
  ];

  await Promise.all(
    routes.map(async route => {
      const page = await read(route);
      const references = [...page.matchAll(/(?:href|src)="([^"]+)"/g)]
        .map(([, href]) => href)
        .filter(href => !/^(?:[a-z][a-z\d+.-]*:|#)/i.test(href));

      await Promise.all(references.map(href => access(target(route, href))));
    })
  );
});

test('canonical guides are rendered at short routes', async () => {
  const [authoring, security, design] = await Promise.all([
    read('authoring'),
    read('security'),
    read('design')
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

test('mike owns the published version paths', async () => {
  const config = await readFile(path.join(root, 'mkdocs.yml'), 'utf8');
  assert.match(config, /provider: mike/);
  assert.match(config, /alias_type: redirect/);
  assert.match(config, /canonical_version: latest/);
});

test('the demo opens Chinook in Jupyter Notebook', async () => {
  const instructions = (
    await readFile(path.join(root, 'lite', 'files', 'README.md'), 'utf8')
  ).trim();
  const notebooks = await Promise.all(
    [
      path.join(root, 'examples', 'chinook.ipynb'),
      path.join(output, 'demo', 'files', 'chinook.ipynb')
    ].map(async source => JSON.parse(await readFile(source, 'utf8')))
  );
  const [home, runtime] = await Promise.all([
    read(''),
    readFile(path.join(output, 'demo', 'jupyter-lite.json'), 'utf8').then(
      JSON.parse
    )
  ]);

  const extension = runtime['jupyter-config-data'].federated_extensions.find(
    ({ name }) => name === 'correxit'
  );
  await Promise.all([
    access(path.join(output, 'demo', 'notebooks', 'index.html')),
    access(path.join(output, 'demo', 'lab', 'index.html')),
    access(path.join(output, 'demo', 'files', 'chinook.db')),
    access(path.join(output, 'demo', 'extensions', 'correxit', extension.load))
  ]);
  assert.equal(
    (await lstat(path.join(output, 'demo'))).isSymbolicLink(),
    !process.env.MIKE_DOCS_VERSION
  );
  assert.match(home, /href="demo\/notebooks\/?\?path=chinook\.ipynb"/);
  notebooks.forEach(notebook => {
    const [welcome] = notebook.cells;
    assert.equal(welcome.cell_type, 'markdown');
    assert.equal(welcome.source, instructions);
    assert.equal(notebook.metadata.correxit.cells[welcome.id], undefined);
  });
  assert.equal(runtime['jupyter-config-data'].appUrl, './notebooks');
  assert.equal(runtime['jupyter-config-data'].baseUrl, './');
});
