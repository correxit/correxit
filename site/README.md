# Correxit website

The source for [correx.it](https://correx.it). It is deliberately a static part
of the Correxit repository:

- `index.html` and `style.css` are the hand-written website.
- `build.mjs` renders the canonical repository Markdown into documentation.
- TypeDoc generates a reference from the public TypeScript entry points.
- the existing JupyterLite testbed is included at `/demo/`.
- `_api/` and `_output/` are generated and are not checked in.

There is no client-side website framework, package, or hosting runtime. The
only browser JavaScript in the published artifact belongs to JupyterLite and
Correxit itself.

Build the extension, JupyterLite demo, and website together:

```bash
pixi run jlpm build
pixi run jlpm build:lite
```

Then serve the complete result at <http://localhost:8888>:

```bash
pixi run jlpm serve
```

After an initial JupyterLite build, `pixi run jlpm build:site` is enough to
refresh the landing page, guides, and API reference.
