# Making a Correxit release

Publishing is deliberately disabled in GitHub Actions until the repository is
public and its package registries and Pages settings have been configured. Pull
requests still build and test the complete website without pushing it anywhere.

## Release checks

Run the checks from the repository root in the Pixi environment:

```bash
pixi run jlpm
pixi run jlpm lint:check
pixi run jlpm test --runInBand
pixi run jlpm build
pixi run jlpm build:lite
pixi run jlpm test:site
```

Run targeted Playwright tests from `ui-tests/` before the full suite when a
change touches workbook lifecycle, Corrector, Reviewer, or propagation.

## Versioned website

`mike` publishes one self-contained static snapshot per package version to the
`gh-pages` branch. A release therefore owns paths such as:

```text
/2.0.0/
/2.0.0/authoring/
/2.0.0/api/
/2.0.0/demo/notebooks/?path=chinook.ipynb
```

`/latest/...` redirects to the corresponding page in the current release, and
the domain root redirects to `/latest/`. Use an exact version URL when a link
must remain fixed. The pre-release unversioned routes are not part of the public
compatibility contract.

The ordinary local build links `/demo/` to `lite/_output` for a fast watch loop.
During `mike deploy`, the build copies and dereferences the complete JupyterLite
site instead, so a released version has no dependency on the current source
tree and contains no symlinks.

After the repository is public, make the first website release manually:

```bash
pixi run jlpm build
pixi run jlpm build:lite
pixi run jlpm test:site
pixi run mike deploy --push --update-aliases 2.0.0 latest
pixi run mike set-default --push latest
```

Replace `2.0.0` with the exact package version. The first three commands are
local checks; the final two are the only commands that publish. Deploying a new
version leaves every earlier version intact. Treat exact versions as immutable
once announced; explicitly deploying the same number again would replace only
that snapshot.

Once `gh-pages` exists, configure GitHub Pages to publish its root, then set
`correx.it` as the custom domain in the repository's Pages settings and enable
HTTPS. GitHub will place `CNAME` at the branch root; `mike` preserves unrelated
root files and supplies `.nojekyll`. Do this configuration before changing DNS
or announcing the site.

## Workbook format policy

Correxit 1.x and `cxtformat: 1` are provisional until the first public Correxit
2.0 release. Workbooks produced during this pre-release period are test
artifacts and may require re-creation after upgrades. Correxit 2.0 freezes the
format-1 contract.

Thereafter, incompatible persisted-format changes require a new `cxtformat`,
while readers for supported earlier formats are retained. Package versions and
workbook-format versions are independent. Changes to authenticated terms, such
as the assignment MAC or issue digest surfaces, are persisted-format changes.

## Packages

The Python package is built with:

```bash
pixi run python -m build
```

Inspect the artifacts in `dist/` before uploading them to PyPI. The frontend
package is published separately to npm with public access. Registry publishing
must remain a manual, authenticated action until the Correxit organization owns
the corresponding projects and secrets.
