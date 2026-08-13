# <img src="style/brand/correxit-github-avatar.png" alt="" width="40"> Correxit

[![Github Actions Status](https://github.com/notebook-link/correxit/workflows/Build/badge.svg)](https://github.com/notebook-link/correxit/actions/workflows/build.yml)

Correxit is a kernel-agnostic Jupyter extension for grading Jupyter notebooks.
It is also the third-person singular perfect active indicative conjugation of
the Latin verb _corrigere_, to correct.

The Python package delivers the extension to JupyterLab and bundles the
schemas that register settings and toolbar contributions. All grading logic
runs in the browser; there is no server component.

## Documentation

| Document                  | Audience            | Content                                                   |
| ------------------------- | ------------------- | --------------------------------------------------------- |
| [AUTHORING](AUTHORING.md) | Assignment author   | How to create, configure, test, and distribute a workbook |
| [DESIGN](DESIGN.md)       | Developer           | Architecture, data model, async patterns                  |
| [MOODLE](MOODLE.md)       | Teacher, integrator | Browser-only Moodle workflow and constraints              |
| [SECURITY](SECURITY.md)   | Developer, auditor  | Threat model, encryption, key management                  |
| [PLUGINS](PLUGINS.md)     | Integrator          | Plugin token interfaces for LMS and transport             |
| [RELEASE](RELEASE.md)     | Maintainer          | Release process and versioning                            |
| [CHANGELOG](CHANGELOG.md) | Everyone            | Version history                                           |

## What does it do? How does it work?

With Correxit, a user can convert a Jupyter notebook using any language kernel
into a gradable workbook.

- All of the workbook creation and grading logic happens in the Jupyter
  frontend (JupyterLab / Jupyter Notebook / JupyterLite). There is no backend.
- All workbook data for both a grader and a student is contained within the
  document itself, which is a Jupyter notebook (`.ipynb`) file with a `correxit`
  field in its metadata. That object carries a required `cxtformat`
  discriminator independent of the package version. There is no other data
  store.
- The author converts a Jupyter notebook into a workbook by configuring which
  cells to grade, optionally setting a local late policy for backendless
  workflows, and encrypting the grading logic with a passphrase.
- A grader uses the Correxit Corrector panel to scan a directory of submitted
  workbooks, optionally unlock them, and batch-grade them, with configurable
  concurrency and a per-workbook timeout to handle hung kernels.

This video shows an example, a SQL (`xeus-sql`) Jupyter notebook that loads the
Chinook database in SQLite and runs some queries and renders a Vega graph of the
genres and media types tables. The user converts the notebook into a workbook
and demonstrates the basic features of Correxit.

https://github.com/user-attachments/assets/04c5218e-772d-4e94-afca-2af2e15864d1

## Requirements

- JupyterLab >= 4.0.0 or Jupyter Notebook >= 7.0.0
- Node.js >= 20.0.0 for the optional Node runtime assignment entrypoint

## Node Runtime Assignment

Correxit also publishes a narrow Node runtime entrypoint for issuing one
already-authored workbook without reopening the Jupyter UI:

```js
import { Assignment } from '@quantstack/correxit/node';

const assigned = await Assignment.assign({
  notebook,
  assignee: 'foo@example.com',
  key: null,
  passphrase: secret
});
```

The host application supplies the notebook JSON, passphrase or derived key, and
final distribution step. Correxit keeps those secrets in memory for this pure
notebook transformation; it does not add a backend authority or trusted third
party. See `examples/assign-one.mjs` for a minimal script.

## Install

To install the extension, execute:

```bash
pip install correxit
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall correxit
```

## Troubleshoot

If you cannot see the Correxit sidebar in Jupyter, check that the frontend
extension is installed:

```bash
jupyter labextension list
```

## Contributing

### Development install

Install [Pixi](https://pixi.sh) first. Pixi provides the Python, NodeJS,
JupyterLab, JupyterLite, and build tools used by this checkout.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. Correxit keeps
the normal JupyterLab extension workflow: prefix commands with `pixi run`, or
enter `pixi shell` and run them directly.

```bash
# Clone the repo to your local environment
# Change directory to the correxit directory
# Create the locked development environment
pixi install
# Link your development version of the extension with JupyterLab
pixi run jupyter labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
pixi run jlpm build
```

You can watch the source directory and run JupyterLab at the same time in
different terminals to watch for changes in the extension's source and
automatically rebuild the extension.

```bash
# Watch the source directory in one terminal and automatically rebuild
pixi run jlpm watch
# Run JupyterLab in another terminal
pixi run jupyter lab
```

With the watch command running, every saved change will immediately be built
locally and available in your running JupyterLab. Refresh JupyterLab to load the
change in your browser (you may need to wait several seconds for the extension
to be rebuilt).

### JupyterLite development

Correxit runs entirely in the browser, so you can develop against JupyterLite
instead of a full Jupyter Server. The workflow uses two watch processes and a
symlink so that every saved TypeScript change is immediately available after a
browser refresh.

**1. Build the JupyterLite site once:**

```bash
pixi run jlpm build:lite
```

This pre-compiles the xeus Wasm kernels, copies example content into the static
site, mounts content files into the kernel virtual filesystem, and runs
`jlpm link:lite` to symlink the built extension back to `correxit/labextension`.
Because of the symlink, subsequent TypeScript rebuilds are picked up without
re-running `build:lite`.

**2. Start two terminals:**

```bash
# Terminal 1: rebuild on every save
pixi run jlpm watch

# Terminal 2: serve the static site at http://localhost:8888
pixi run jlpm serve
```

**3. Open `http://localhost:8888` and refresh after each rebuild.**

If you rebuild the labextension outside of `build:lite` (e.g. after a clean),
run `pixi run jlpm link:lite` to re-establish the symlink and patch the
manifest hash.

The `lite/` directory contains:

| File                       | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `jupyter_lite_config.json` | Build configuration: contents directory, Service Worker toggle                    |
| `environment.yml`          | Wasm kernel environment (xeus-python, xeus-sqlite) resolved from emscripten-forge |
| `link.mjs`                 | Post-build script that symlinks the dev extension and patches the manifest hash   |

By default, the `jlpm build` command generates the source maps for this
extension to make it easier to debug using the browser dev tools. To also
generate source maps for the JupyterLab core extensions, you can run the
following command:

```bash
pixi run jupyter lab build --minimize=False
```

### Development uninstall

The Pixi development environment lives in `.pixi/` and can be deleted when you
no longer need the local workbench.

In development mode, you will also need to remove the symlink created by
`jupyter labextension develop` command. To find its location, you can run
`pixi run jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `correxit` within that
folder.

### Testing the extension

#### Frontend tests

This extension is using [Jest](https://jestjs.io/) for JavaScript code testing.

To execute them, execute:

```sh
pixi run jlpm
pixi run jlpm test
```

#### Integration tests

This extension uses [Playwright](https://playwright.dev/docs/intro) for the
integration tests (aka user level tests).
More precisely, the JupyterLab helper
[Galata](https://github.com/jupyterlab/jupyterlab/tree/master/galata) is used to
handle testing the extension in JupyterLab.

More information is provided within the [ui-tests README](./ui-tests/README.md)

### Packaging the extension

See [RELEASE](RELEASE.md)
