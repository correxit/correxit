# Correxit website

The source for [correx.it](https://correx.it) is part of the Correxit repository:

- MkDocs Material supplies the static documentation theme and search.
- `index.md` is the landing page.
- `prepare.mjs` stages the canonical repository Markdown and the TypeDoc API
  reference in `_docs/`.
- `hooks.py` links the existing JupyterLite build at `/demo/` during local
  development and copies it into each published version.
- `mike` keeps numbered snapshots under permanent version paths and provides
  the version selector. `/latest/` redirects to the newest stable website release.
- `snapshot.py` assembles and tests the numbered snapshots and redirects for
  GitHub Pages, preserving existing versions when publication is retried.
- `_api/`, `_docs/`, `_output/`, `_pages/`, and `lite/_output/` are generated and
  are not checked in on source branches.

There is no website server or application framework. The released site is a
self-contained static snapshot, including the JupyterLite demo.

Build the extension, demo, and current website together:

```bash
pixi run jlpm build:lite
pixi run jlpm test:site
```

Serve that development build at <http://localhost:8888>:

```bash
pixi run jlpm serve
```

After the initial JupyterLite build, `pixi run jlpm build:site` refreshes the
landing page, guides, and API reference. Its demo remains linked to
`lite/_output`, so extension watch builds are visible after a browser refresh.

Published routes are versioned, for example `/2.0.0/authoring/` and
`/2.0.0/demo/`. The **Publish website** workflow deploys published stable GitHub
releases and can also retry an existing release manually from GitHub. See
[the release guide](../docs/release.md) for publication and retry instructions.

To verify the complete versioned site locally after building, run
`pixi run python site/snapshot.py`. It updates the local `gh-pages` branch and
extracts the snapshots into `site/_pages/` without pushing or deploying.
