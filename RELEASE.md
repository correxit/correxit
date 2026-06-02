# Making a new release of Correxit

The extension can be published to `PyPI` and `npm` manually or using the [Jupyter Releaser](https://github.com/jupyter-server/jupyter_releaser).

For local release checks in the Correxit development environment, use:

```bash
mamba run -n correxit jlpm build:lib
mamba run -n correxit jlpm test --runInBand
mamba run -n correxit jlpm lint:check
mamba run -n correxit jlpm build
```

Run targeted Playwright tests from `ui-tests/` before the full suite when a
change touches workbook lifecycle, Corrector, Reviewer, or propagation.

Changes to the assignment MAC surface are workbook-format breaks. Before
releasing a build that expands the authenticated terms, confirm that any
in-flight assigned workbooks have been re-issued, because older workbooks will
fail unlock with a MAC mismatch.

### Python package

This extension can be distributed as Python packages. All of the Python
packaging instructions are in the `pyproject.toml` file to wrap your extension in a
Python package. Before generating a package, you first need to install some tools:

```bash
pip install build twine hatch
```

Bump the version using `hatch`. By default this will create a tag.
See the docs on [hatch-nodejs-version](https://github.com/agoose77/hatch-nodejs-version#semver) for details.

```bash
hatch version <new-version>
```

Make sure to clean up all the development files before building the package:

```bash
jlpm clean:all
```

You could also clean up the local git repository:

```bash
git clean -dfX
```

To create a Python source package (`.tar.gz`) and the binary package (`.whl`) in the `dist/` directory, do:

```bash
python -m build
```

> `python setup.py sdist bdist_wheel` is deprecated and will not work for this package.

Then to upload the package to PyPI, do:

```bash
twine upload dist/*
```

### NPM package

To publish the frontend part of the extension as a NPM package, do:

```bash
npm login
npm publish --access public
```
