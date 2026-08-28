# Correxit website

The source for [correx.it](https://correx.it). It is deliberately a static part
of the Correxit repository:

- Pico CSS provides the typography and component baseline; `style.css` contains
  only Correxit's brand and documentation layout.
- `index.html` is the hand-written landing content.
- `templates/` contains the shared Mustache page, navigation, and document
  layouts.
- `build.mjs` prepares page data and renders the canonical repository Markdown.
- TypeDoc generates a reference from the public TypeScript entry points.
- the existing JupyterLite testbed is included at `/demo/`; public links open
  the Chinook workbook in Jupyter Notebook, while JupyterLab remains at
  `/demo/lab/`.
- `_api/` and `_output/` are generated and are not checked in.

There is no client-side website framework or hosting runtime. Mustache is used
only while building static HTML. The Pico CSS dependency and its license are
copied into the output at build time. The only browser JavaScript in the
published artifact belongs to JupyterLite and Correxit itself.

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

Run `pixi run jlpm test:site` after either build to verify generated routes,
local references, inactive Markdown, and the embedded demo.
