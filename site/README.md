# Correxit website

The source for [correx.it](https://correx.it) is part of the Correxit repository:

- MkDocs Material supplies the static documentation theme and search.
- `index.md` is the landing page.
- `prepare.mjs` stages the canonical repository Markdown and the TypeDoc API
  reference in `_docs/`.
- `hooks.py` links the existing JupyterLite build at `/demo/` during local
  development and copies it into each published version.
- `mike` keeps released sites under permanent version paths and provides the
  `latest` selector and redirect.
- `_api/`, `_docs/`, `_output/`, and `lite/_output/` are generated and are not
  checked in.

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
`/2.0.0/demo/`. See [the release guide](../docs/release.md) for the deliberately
manual publishing step.
