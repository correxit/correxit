# Correxit Security Model

Correxit is a serverless, frontend-only JupyterLab extension. All logic runs
in the browser. There is no backend authority or trusted third party.
Cryptographic primitives use `window.crypto` and `openpgp.js`.

## Threat Profile

| Threat                                   | Mitigation                                             |
| ---------------------------------------- | ------------------------------------------------------ |
| Student reads the reference cells        | Secret reference cell encryption (AES-256 via openpgp) |
| Student reads answerable payload         | Answer payload is a digest (SHA-256 hash)              |
| Student reads the roster                 | Roster encryption (AES-256 via openpgp)                |
| Student alters authored assignment state | Assignment MAC (keyed SHA-256 hash)                    |
| Student edits cells after submission     | Workbook locking + freezing                            |
| Peer reads answers from file             | Sealed submissions (PGP encryption to author key)      |
| Student tampers after submit             | Seal hash + transport integrity (see below)            |
| Student copies peer's sealed blobs       | Assignee + cell id bound inside encrypted payload      |
| Student starts from a forged blank slate | `issue` digest + `issuer` PGP signature                |

**Out of scope:** malicious authors, browser memory extraction,
compromised JupyterLab servers, and preventing cross-student file access
itself. Those are trust, host, or LMS access-control problems, not
workbook-format problems. If a peer does obtain another student's file,
Correxit still aims to protect the contents it actually encrypts or seals:
secret references, the roster, and sealed submission sources.

## Key Management

Plaintext keys are **never written to disk**. They exist only in local scope,
enter via user input, and die with the browser tab. `Rubric.Unlocked` carries
the PBKDF2 key; `Rubric.Locked` has `key: null`. Notebook metadata stores only
locked rubrics.

The author's PGP private key is stored in
`assignment.keys.private.author`, encrypted with the same
PBKDF2-derived symmetric key that encrypts the roster. `unlock`
recovers it into local scope, uses it, and discards it before
returning.

### Settings Secrets

Provider-dispatched plugins may receive API tokens via the JupyterLab settings
editor. `dispatcher.ts` registers a `compose` transform that intercepts token
values, moves them to `SecretsManager`, blanks them from persisted JSON, and
re-injects them into composite settings on later loads.

## Integrity

### Assignment MAC

Authenticates the mutable author-controlled assignment state:
`assignee`, `expiration`, `id`, `issue`, `issuer`, `keys`
(author components only), `name`, `report` (interventions +
scores, sorted), and `roster`.

The `mac` function extracts `Keys.author(keys)` to include only
`{ private, public }` for the author. Student key fields
(`keys.private.assignee`, `keys.public.assignee`) are present in
`Terms` but absent from the unsigned object, so they do not affect
the HMAC. A student setting their own keypair at submit time does
not invalidate the MAC.

```
mac = HMAC-SHA-256(JSON.stringify(unsigned), key)
```

Any modification to authenticated fields invalidates the MAC.

This is different from `Workbook.Identifier`. `Identifier` is a small routing
key. The MAC proves that the broader authored assignment state still matches
the secret key held by the author side of Correxit.

**Authenticated:** `assignee`, `expiration`, `id`, `issue`,
`issuer`, `keys` (author only), `name`, `report`, `roster`.

**Not authenticated:** `certification`, `collected`, `distribution`, `seal`,
`submission`, `submitted`. These change after signing or are set by the
student (who does not have the symmetric key).

### Blank-Slate Authenticity

Each propagated workbook carries two additional assignment fields:

- `issue`: a deterministic digest of the issued blank-slate state
- `issuer`: a cleartext PGP signature over that digest made with the
  author key

These fields stay stable after later author-side edits. They answer a
different question from the MAC: whether the student started from the authentic
issued workbook.

### Seal Integrity

Sealed submissions use a separate integrity mechanism. At submit time, the
SHA-256 hash of all ciphertexts, sorted by cell id and joined with newline, is
stored as `assignment.seal`. At unlock time, `Workbook.unlock` recomputes the
hash from the current ciphertexts. A mismatch fails the workbook.

The seal hash is **not signed**. It cannot be: at submit time the workbook is
locked and the HMAC key is absent. The hash detects accidental corruption and
casual tampering. It does not stop a sophisticated student from re-encrypting
cells with the cleartext public key, recomputing the hash, and updating
`assignment.seal`. Strong post-submission integrity against deliberate file
modification depends on the Submitter plugin delivering an independent copy to
the LMS at submit time.

### Transport Integrity (Plugin Responsibility)

The distributor does not return a receipt. Correxit records only the local
`assignment.distribution` timestamp after a successful delivery and save.
Blank-slate authenticity comes from `issue` and `issuer`, not from
distribution. If an LMS needs a delivery receipt, that record belongs to the
external system.

## Encryption

### Symmetric (AES-256 via openpgp, password-based)

- **Reference cells:** `comparable` and `correctable` cells marked
  `secret: true` have their reference cells encrypted with the
  assignment key on lock. Students cannot read secret reference
  answers without the key. Cells marked `secret: false` leave
  reference cells visible.
- **Roster:** Encrypted with the assignment key on lock. Students
  cannot enumerate the roster.
- **Answerable cells:** Store a SHA-256 digest of the expected
  output, not the output itself. One-way.
- **Author PGP private key:** Encrypted with the PBKDF2 key at
  authoring time. Stored in `assignment.keys.private.author`.
- **Student PGP private key:** Encrypted with the student's own
  PBKDF2 key (derived from their passphrase). Stored in
  `assignment.keys.private.assignee`. Null for fire-and-forget
  submissions.

### Asymmetric (PGP, Curve25519)

- **Sealed submissions:** At submit time, each rubric cell's source
  is encrypted as `JSON.stringify({ assignee, id, source, type })`
  using `security.seal` with the author's PGP public key (and
  optionally the student's). The cell is converted to `raw` type
  with `editable: false` and `source_hidden: true`.

  At grading time, `Workbook.unlock` decrypts the author's PGP
  private key, verifies the seal hash, and unseals each cell. Payload binding
  prevents cross-student replay (`assignee`) and cell rearrangement (`id`).

## Sealed Submissions

### Lifecycle

1. **Authoring** (`Workbook.convert`): `security.keypair()` generates
   a Curve25519 PGP keypair. The public key is stored in cleartext.
   The private key is encrypted with the PBKDF2 key before storage.

2. **Propagation** (`propagator.ts`): No changes. Keys travel in
   assignment metadata, copied to each student notebook. The `seal`
   and student key fields start as null.

3. **Submit, fire-and-forget** (`Workbook.submit`): Each rubric cell
   is sealed to `[keys.public.author]`. Cells are sorted by id.
   The seal hash is computed and stored. The workbook is frozen.

4. **Submit, with passphrase** (`commands.ts: submit`): Student
   generates their own keypair. Their private key is encrypted
   with their PBKDF2 key. Cells are sealed to both
   `[keys.public.author, keys.public.assignee]`.

5. **Revise** (`commands.ts: revise`, `Workbook.revise`): Student
   enters a passphrase, derives a key, decrypts their PGP private key,
   unseals all cells, clears `seal`, `submission`, `submitted`, and
   student key fields, then defrosts the notebook.

6. **Grading** (`Workbook.unlock`): Validates metadata first so a tampered
   workbook never gets plaintext written. If `assignment.seal` is non-null, it
   decrypts the author PGP private key in local scope, verifies the seal hash,
   unseals each cell, and clears `seal` because the cells are now plaintext.
   Finally, it decrypts reference cells.

If rubric cells are missing from the notebook, headed workbooks skip seal
verification and unseal only the remaining cells. Headless workbooks
hard-fail. This matches `audit()`, which tolerates and prunes missing cells
in headed mode but rejects incomplete notebooks in headless mode.

### Payload Binding

Each sealed cell payload is `{ assignee, id, source, type }`. At unseal time:

- `assignee` must match `assignment.assignee`. Prevents Student B
  from copying Student A's ciphertexts.
- `id` must match the cell id in the notebook. Prevents cell
  rearrangement after submission.
- `type` restores the original cell type (e.g. `code`, `markdown`)
  from `raw`.

Cross-assignment replay is not a concern: each rubric gets a fresh random PGP
keypair at authoring time, so ciphertext from one assignment cannot be
decrypted by another assignment's key.

### Post-Grading Plaintext

Graded notebooks are saved with student answers decrypted. The seal protects
the submission-to-grading corridor. After certification, the notebook is a
feedback receipt, so students need plaintext to review scores and outputs.
Re-encrypting after grading would lock fire-and-forget students out of their
own feedback for no security gain.

### PGP Nondeterminism

PGP encryption uses random session keys. Encrypting the same
plaintext twice produces different ciphertext. The seal hash can
only be verified by hashing the existing ciphertexts, never by
re-encrypting and comparing.

## Lifecycle

### Assignment Fields

| Field           | Type             | Signed? | Meaning                             |
| --------------- | ---------------- | ------- | ----------------------------------- |
| `assignee`      | `string`         | Yes     | Student identifier                  |
| `roster`        | `string[]`       | Yes     | Encrypted on lock                   |
| `expiration`    | `number \| null` | Yes     | Deadline                            |
| `id`            | `string \| null` | Yes     | External assignment id              |
| `keys`          | `Keys`           | Partial | Author keys MACed, student keys not |
| `name`          | `string`         | Yes     | Assignment display name             |
| `report`        | `Report`         | Yes     | Scores + interventions              |
| `issue`         | `string`         | Yes     | Deterministic blank-slate digest    |
| `issuer`        | `string`         | Yes     | Author PGP signature over `issue`   |
| `seal`          | `string \| null` | No      | SHA-256 of concatenated ciphertexts |
| `mac`           | `string`         | -       | Mutable assignment authenticity MAC |
| `certification` | `number \| null` | No      | When the grade was finalized        |
| `submission`    | `number \| null` | No      | When the student submitted          |
| `submitted`     | `string \| null` | No      | External submission receipt         |
| `distribution`  | `number \| null` | No      | Local distribution timestamp        |
| `collected`     | `string \| null` | No      | External collection receipt         |

### Certification Sequence

1. `correct()` - execute cells, compute scores, sign report
   if all cells resolve
2. `certify()` - write certification timestamp
3. `lock()` - encrypt reference cells and roster, erase key
4. `freeze()` - set cells to non-editable

A workbook cannot be collected without a non-null `certification`.

### Verification

- `Assignment.validate({ assignment, key })` - structural checks:
  assignee must appear in roster, MAC must be valid if assignee or
  roster exists, issue and issuer must appear together and verify,
  author keys must be present, sealed
  assignments must have an author public key, assignee private key
  requires a corresponding public key.

## Serialization Invariant

All optional fields use `Type | null`, never `Type?`. This keeps
`JSON.stringify` deterministic: `null` is serialized, `undefined` is omitted.
Since MACs hash stringified JSON, field presence must stay stable.

## Key Representation

The PBKDF2-derived key is a 256-bit value stored as a 64-character lowercase
hex string. `hmac` decodes this to 32 raw bytes before importing it as HMAC
key material. The same hex string is used as-is for the openpgp symmetric
password.

## Assignee Key Lifecycle

Assignee key fields start as null from propagation and remain null unless the
student chooses "Set passphrase" at submit time. `Rubric.unseal()` clears them
back to null on revise. Fire-and-forget submissions therefore never offer a
revise option.

`Rubric.assign()` preserves keys when reassigning, but it only operates on
unlocked rubrics, where assignee key fields are always null. Stale student
keys therefore cannot leak across assignments.

## Known Limitations

1. **Client-side only.** A technically sophisticated student could
   modify extension code in-browser to bypass locking or encryption.
   The cryptographic mechanisms detect tampering after the fact.

2. **No separation of duties.** The author holds the key and
   can perform any operation. There is no independent audit role.

3. **Seal is unsigned.** The seal hash is SHA-256, not HMAC. A
   student with file access and the cleartext public key could
   forge new ciphertexts and a matching hash. The seal detects
   corruption, not deliberate forgery. See Seal Integrity.
