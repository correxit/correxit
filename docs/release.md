# Making a Correxit release

Publishing a stable GitHub release publishes the npm and PyPI packages and the
versioned website. Pull requests and pushes to `main` run CI without publishing.

## Release

1. Prepare a PR from a branch in this repository to `main`, increasing the
   stable version in `package.json`. **Generate changelog** commits an entry to
   [CHANGELOG](../CHANGELOG.md) using GitHub's generated notes for merged PRs
   since the base version's tag. Review that entry before merging. Add any
   compatibility guidance or other hand-written notes outside its generated
   markers; subsequent pushes refresh only the generated block.
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

Changelog generation requires the previous version's tag to be an ancestor of
the release branch and refuses to change notes for an already tagged version.
It skips PRs without a version change and PRs from forks. The job uses the
repository's `GITHUB_TOKEN` and explicitly starts CI after committing its update.
The open release PR itself is not yet in GitHub's merged-PR notes, so describe
any changes made within it in the hand-written portion of the entry.

The workflow executes the generator from the PR's exact base commit, so changes
to the generator take effect after merging. If the base has no generator yet,
the job skips generation with a notice; maintain that first PR's notes manually.
The automation remains restricted to branches in this repository and trusts
repository writers to manage its workflow and permissions.

If you change or revert the proposed version after notes have been generated,
the job fails until you rename or remove the obsolete release heading and
generated block. Move any hand-written notes you want to keep to the appropriate
entry; the job never deletes them automatically.

To generate the same entry locally with an authenticated GitHub CLI:

```bash
pixi run node scripts/changelog.mjs origin/main
```

## Retry a failed publication

- **Packages:** fix the failure and select **Re-run failed jobs** on the original
  **Publish packages** run. Retries require the retained CI artifacts.
- **Website:** open **Publish website → Run workflow**, choose `main`, and enter
  the published release tag.

The packages and website publish independently. Retry the failed publication
using the original tag; do not move the tag or recreate the release.

## Versioning

For 2.1.0, requiring `Unlocker.request` is an intentional exception to strict
SemVer while Correxit has no known external plugin consumers. Custom unlockers
must implement it; that release retained workbook-format compatibility.

For 2.2.0, superseding the unused draft workbook format and requiring
`Workbook.Grade.verified` are intentional exceptions to strict SemVer. Format 1
never had usage in the wild; format 2 is the only supported format. Custom
integrations must follow the authenticated grade-result contract in
[PLUGINS](plugins.md).

Numbered website snapshots, such as `/2.0.0/`, remain fixed. The domain root
serves the newest stable homepage directly, with links to its guides and demo.
`/latest/` initially redirects to that version and can serve refreshed
documentation between releases. Backports and retries preserve refreshed
documentation and do not move the homepage or `latest` backwards.

## Update the documentation without a release

Merge the page changes to `main` and wait for CI to pass. Open **Publish website
→ Run workflow**, select `main`, and leave `tag` empty.

This publishes the current homepage and `/latest/` guides, API reference, search,
sharing metadata, and theme assets without publishing npm or PyPI packages or
rebuilding JupyterLite. The demo is copied from the newest stable website release.
The homepage links to the refreshed documentation at `/latest/`. A stable website
snapshot must already exist, and numbered snapshots remain fixed. Retries and
backports preserve the refreshed documentation; the next newer stable release
replaces it with that release's homepage and guides.

## Workbook format

`cxtformat: 1` was a draft with no usage in the wild. Although Correxit 2.0
described it as frozen, format 2 supersedes it to authenticate issued contents.
Format 1 is rejected; no legacy reader or migration path is retained. The
bundled Chinook workbook has been authenticated and re-signed as format 2.
See [SECURITY](security.md) for the supported contract.

Future incompatible persisted-format changes require a new `cxtformat` and an
explicit compatibility policy for existing workbooks. Package versions and
workbook-format versions are independent. Changes to authenticated terms, such
as the assignment MAC or issue digest surfaces, are persisted-format changes.

When releasing this change, call out the workbook-format transition and the
CSV contract: exports from scanning alone leave scores blank; authenticated
batch grading can reuse valid reports without kernel execution. Package
version selection remains separate from `cxtformat`.

## Local packaging

To inspect package archives without publishing:

```bash
pixi run python -m build
pixi run jlpm build:npm
pixi run npm pack --ignore-scripts --pack-destination dist
```

Website development commands are in the [site README](../site/README.md).
