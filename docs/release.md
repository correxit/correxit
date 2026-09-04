# Making a Correxit release

Publishing is deliberately disabled in GitHub Actions until the repository has
become public at `github.com/correxit/correxit` and its package registries and Pages
settings have been configured. Pull requests still build and test the complete
website without pushing it anywhere.

## Public transition

Before changing the repository visibility:

- verify `correx.it` in the `correxit` organization Pages settings and keep
  the DNS challenge TXT record;
- audit the complete Git history and contributor provenance, not only the
  current tree;
- review or delete private Actions logs and artifacts that should not become
  public;
- decide whether the pre-public 1.x GitHub release objects should remain
  visible; and
- confirm control of the existing `correxit` projects on PyPI and npm.

Do not publish the website from a working directory that contains ignored
notebooks, rosters, checkpoints, or other local data. Use a clean checkout for
every release.

Immediately after making the repository public, before accepting external pull
requests:

- protect `main` with a ruleset requiring a pull request, code-owner review,
  CI, PR-title validation, and the configured CLA check;
- require approval before Actions workflows from every external contributor
  can run;
- enable Dependabot alerts, secret scanning, push protection, code scanning,
  and private vulnerability reporting;
- restrict allowed Actions and require full-length commit SHA references; and
- enable organization two-factor authentication after confirming that every
  member and outside collaborator is ready.

The CLA check must cover the pull request author and every commit author or
co-author, bind acceptance to the applicable CLA version, retain an auditable
record, and allow only documented exemptions. Until that check is installed,
follow the manual process in [CONTRIBUTING.md](../CONTRIBUTING.md).

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

After the repository is public, make the first website release manually from a
clean checkout:

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
package is published separately to npm with public access.

The existing PyPI and npm projects predate the repository move. Confirm their
maintainers, require two-factor authentication, and replace their old project
links with the metadata from the 2.0 release. Configure separate PyPI and npm
trusted publishers for a narrowly scoped `release.yml` workflow in
`correxit/correxit`. Use a protected GitHub environment with required
reviewers and short-lived OIDC credentials rather than restoring the former
personal-token semantic-release workflow.

Build distributions in an ordinary read-only job. A separate publishing job
should receive only the already-built artifacts and the minimum
`id-token: write` permission required by the registries. Keep publishing
manual until both trusted-publisher relationships and their environment
protections have been tested.
