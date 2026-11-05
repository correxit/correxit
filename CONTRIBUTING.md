# Contributing to Correxit

See the [README](README.md#development-install) for development setup and
[AGENTS](AGENTS.md) for architecture, conventions, and testing instructions.

## Contributor License Agreement

Correxit verifies CLA acceptance manually during pull request review. The
[CLA acceptance register](CLA-SIGNATURES.md) records one acceptance per
contributor and agreement revision. An existing acceptance covers later
contributions under that same revision; a new PR does not require another
signature.

Contributions submitted before **00:00 UTC on 1 January 2028** require
acceptance of the [CLA](CLA.md), unless the necessary rights are already held
under another applicable agreement. Contributions submitted at or after that
time require no CLA. Retain earlier acceptance records after the transition.

### Recording acceptance

Read the agreement and confirm that you have authority to grant its rights.
If your acceptance of the current revision is already in the register, link
that entry in your PR. Otherwise, post a comment from your own GitHub account
using the following statement. Replace `CLA_URL` with the immutable agreement
link in the register:

> I have read and accept the Correxit Contributor License Agreement at
> CLA_URL. I have authority to grant the rights in that agreement and intend
> this comment to record my electronic signature.

Each contributor whose work is included must record their own acceptance.
Posting on someone else's behalf or checking the PR checklist does not record
their acceptance. If another agreement already supplies the necessary rights,
ask a maintainer to verify that coverage; do not publish confidential terms.

### Maintainer verification

Before merging a contribution submitted before the transition:

1. Identify all contributors, including co-authors. Resolve any commit author
   that GitHub cannot associate with an account.
2. Check each contributor's existing register entry against the agreement
   revision that applies. For a new acceptance, verify the comment's author,
   explicit statement, and immutable agreement link.
3. Add an entry to the register with the contributor's name, GitHub login and
   numeric user ID, agreement revision, date recorded, and acceptance evidence.
   Preserve the statement and comment permalink so the record survives a later
   edit or deletion of the comment. Retain any existing hosted-service receipt
   when importing an acceptance; distinguish a contributor's attestation of
   prior acceptance from an exported service receipt.
4. Check the maintainer checkbox in the PR template and note any coverage under
   another agreement without exposing confidential information. Repeat the
   check if a push adds another contributor.

An entry proposed in a PR becomes verified only when a maintainer checks its
evidence and merges it. Keep existing entries; append corrections and new
agreement revisions with their evidence. Do not infer acceptance from commit
authorship, organization membership, a bot's status, or an outage.

### Former CLA Assistant integration

The register and maintainer review replace the hosted CLA Assistant check.
Its GitHub OAuth access was revoked on 5 November 2026. The repository does
not require a `license/cla` status check.

Old PRs can retain a historical pending `license/cla` status. Use the manual
verification process for those PRs; do not recreate the hosted check or treat
its pending status as evidence about acceptance.
