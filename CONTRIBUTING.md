# Contributing to Correxit

See the [README](README.md#development-install) for development setup and
[AGENTS](AGENTS.md) for architecture, conventions, and testing instructions.

## Contributor License Agreement

Contributions submitted before **00:00 UTC on 1 January 2028** require
acceptance of the [CLA](CLA.md), unless the necessary rights are already held
under another applicable agreement. Contributions submitted at or after that
time require no CLA. These terms apply to all Correxit packages, including
`@correxit/contracts`.

Maintainers verify acceptance during PR review and record it in the
[CLA acceptance register](CLA-SIGNATURES.md). One acceptance covers later
contributions under the same agreement revision; you do not need to sign again
for each PR.

### Recording acceptance

Read the agreement and confirm that you have authority to grant its rights.
If your acceptance of the current revision is already in the register, link
that entry in your PR. Otherwise, post a comment from your own GitHub account
using the following statement. Replace `CLA_URL` with the immutable agreement
link in the register:

> I have read and accept the Correxit Contributor License Agreement at
> CLA_URL. I have authority to grant the rights in that agreement and intend
> this comment to record my electronic signature.

Each contributor must record their own acceptance; a PR checkbox does not
replace it. If another agreement supplies the necessary rights, ask a maintainer
to verify coverage without publishing confidential terms.

### Maintainer verification

Before merging a contribution submitted before the transition:

1. Identify all contributors, including co-authors and commit authors GitHub
   cannot associate with an account.
2. Check each contributor's existing register entry against the agreement
   revision that applies. For a new acceptance, verify the comment's author,
   explicit statement, and immutable agreement link.
3. Add an entry to the register with the contributor's name, GitHub login and
   numeric user ID, agreement revision, date recorded, and acceptance evidence.
   Preserve the statement and comment permalink so the record survives a later
   edit or deletion of the comment. When importing an earlier acceptance,
   retain its evidence and identify the source.
4. Check the maintainer checkbox in the PR template and note any coverage under
   another agreement without exposing confidential information. Repeat the
   check if a push adds another contributor.

An entry is verified when a maintainer checks its evidence and merges it. Append
corrections and new revisions rather than removing earlier records. Keep the
register after the CLA requirement ends.

### Former CLA Assistant integration

CLA Assistant's GitHub OAuth access was revoked on 5 November 2026. Old PRs may
still show a pending `license/cla` status. That check is no longer required;
use the manual process above.
