# Contributing to Correxit

Thank you for helping improve Correxit. Participation in the project is
governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Report security issues
through the private process in [SECURITY.md](SECURITY.md), not through a public
issue.

## Before changing code

Read the [design principles](docs/design.md) and
[security model](docs/security.md). Correxit is a frontend-only Jupyter
extension: UI components execute commands, commands orchestrate model changes,
and cryptographic keys never reach disk.

Use the Pixi workbench described in [README.md](README.md). The usual local
checks are:

```bash
pixi install
pixi run jlpm
pixi run jlpm lint:check
pixi run jlpm test --runInBand
pixi run jlpm build
pixi run jlpm test:node
```

Changes to the documentation website should also run:

```bash
pixi run jlpm build:lite
pixi run jlpm test:site
```

Run one relevant Playwright module at a time while developing UI changes, then
run the complete integration suite when appropriate. See
[ui-tests/README.md](ui-tests/README.md).

## Pull requests

- Keep a pull request focused and explain both what changed and why.
- Use a conventional, semantic pull request title; the squash-merged title
  becomes the commit message.
- Add or update tests for changed behavior.
- Preserve explicit nulls, validate before encrypting, and use `Workbook`
  functions for notebook metadata changes.
- Never include student data, credentials, assignment keys, or generated build
  output.

## Contribution terms

For contributions submitted before 00:00 UTC on 1 January 2028, every
contributor whose work appears in a pull request must accept the
[Correxit Contributor License Agreement](CLA.md), unless the necessary rights
are already held under another applicable agreement.

The pull request author records acceptance with the checkbox in the pull
request template. Every additional author or co-author must add a comment to
the pull request containing this exact statement:

> I have read and accept the Correxit Contributor License Agreement, version
> 1.0 dated 15 August 2026, and I am authorized to grant its rights for my
> contributions in this pull request.

Until an automated CLA status check is enabled, maintainers must verify and
record coverage for every author and co-author before merging.

The CLA requirement ends for contributions submitted at or after 00:00 UTC on
1 January 2028. Those contributions are accepted under `BSD-3-Clause` alone.
