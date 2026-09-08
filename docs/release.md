# Making a Correxit release

Publishing a stable GitHub release publishes the npm and PyPI packages and the
versioned website. Pull requests and pushes to `main` run CI without publishing.

## Release

1. Prepare a PR with the version in `package.json` and release notes in
   [CHANGELOG](../CHANGELOG.md).
2. Merge it and wait for CI on the merged commit in `main` to pass.
3. Publish a stable GitHub release at that exact commit. Its tag must be `v`
   followed by the package version, such as `v2.0.0`. Use the changelog entry as
   the release notes.
4. Check **Publish packages** and **Publish website**, then confirm the version
   is available on npm, PyPI, and `correx.it`, including the demo.

Use GitHub's release page or the CLI:

```bash
gh release create v2.0.0 --repo correxit/correxit \
  --target TESTED_COMMIT_SHA --title 'Correxit 2.0.0' \
  --notes-file /path/to/release-notes.md --latest
```

Replace the example version, commit SHA, and notes file as appropriate. Packages
come from the successful CI run for that commit; the website builds from its
release tag. Drafts and prereleases do not publish either.

## Retry a failed publication

- **Packages:** fix the failure and select **Re-run failed jobs** on the original
  **Publish packages** run. Retries require the retained CI artifacts.
- **Website:** open **Publish website → Run workflow**, choose `main`, and enter
  the published release tag.

The packages and website publish independently. Retry the failed publication
using the original tag; do not move the tag or recreate the release.

## Versioning

Numbered website snapshots, such as `/2.0.0/`, remain fixed. The domain root
serves the newest stable homepage directly, with links to its versioned guides
and demo. `/latest/` redirects to that version. Backports and retries do not
move the homepage or `latest` backwards.

Correxit 1.x treated `cxtformat: 1` as provisional. Workbooks produced during
that period may require re-creation. Correxit 2.0 freezes the format-1 contract.
Thereafter, incompatible persisted-format changes require a new `cxtformat`,
while readers for supported earlier formats are retained. Package versions and
workbook-format versions are independent. Changes to authenticated terms, such
as the assignment MAC or issue digest surfaces, are persisted-format changes.

## Local packaging

To inspect package archives without publishing:

```bash
pixi run python -m build
pixi run jlpm build:npm
pixi run npm pack --ignore-scripts --pack-destination dist
```

Website development commands are in the [site README](../site/README.md).
