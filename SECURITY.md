# Correxit Security Model

Correxit is a **serverless, frontend-only** JupyterLab extension.
All logic executes in the browser. There is no backend authority and
no trusted third party. Cryptographic primitives use `window.crypto`
(Web Crypto API) and `openpgp.js`.

## Threat Profile

| Threat                               | Mitigation                                             |
| ------------------------------------ | ------------------------------------------------------ |
| Student reads the reference cells    | Secret reference cell encryption (AES-256 via openpgp) |
| Student reads answerable payload     | Answer payload is a digest (SHA-256 hash)              |
| Student reads the roster             | Roster encryption (AES-256 via openpgp)                |
| Student forges or alters their grade | Assignment signature (keyed SHA-256 hash)              |
| Student edits cells after submission | Workbook locking + freezing                            |
| Peer reads answers from file         | Sealed submissions (PGP encryption to author key)      |
| Student tampers after submit         | Seal hash recomputed at grading time                   |
| Student copies peer's sealed blobs   | Assignee + cell id bound inside encrypted payload      |
| Tampered workbook delivery           | Out-of-band (Consumer/Collector plugin hashing)        |

**Out of scope:** malicious authors (they hold the key, full
authority by design), browser memory extraction, compromised
JupyterLab servers (Correxit has no backend), and cross-student
file access (students reading each other's workbooks is a file
system or LMS access-control concern, not solvable in-workbook).

## Key Management

Plaintext keys are **never written to disk**. They exist only in
closure scope and enter via user input, dying with the browser tab.
The `Rubric.Unlocked` type carries the PBKDF2 key; `Rubric.Locked`
has `key: null`. Notebook metadata only stores locked rubrics.

The author's PGP private key is stored in
`assignment.keys.private.author`, encrypted with the same
PBKDF2-derived symmetric key that encrypts the roster. The
plaintext private key is recovered during `unlock`, used in local
scope, and discarded when the function returns. This parallels the
existing roster encryption: the encrypted blob is opaque without
the passphrase.

### Settings Secrets

Provider-dispatched plugins (Consumer, Registrar) may receive API
tokens via the JupyterLab settings editor. The `dispatcher.ts`
module registers a settings registry `compose` transform that
intercepts any token value, moves it to the `SecretsManager`
(in-memory), and blanks it from the persisted JSON before it
reaches disk. On subsequent loads the transform re-injects the
stored secret into the composite settings so that plugin code
sees the token without it ever being written to a settings file.

## Integrity

### Assignment Signature

Signs the **terms** of the assignment: `assignee`, `expiration`,
`id`, `keys` (author components only), `name`, `report`
(interventions + scores, sorted), and `roster`.

The `sign` function extracts `Keys.author(keys)` to include only
`{ private, public }` for the author. Student key fields
(`keys.private.assignee`, `keys.public.assignee`) are present in
`Terms` but absent from the unsigned object, so they do not affect
the HMAC. A student setting their own keypair at submit time does
not invalidate the signature.

```
signature = HMAC-SHA-256(JSON.stringify(unsigned), key)
```

Proves the assignment contract is authentic. Any modification to
signed fields invalidates the signature.

**Signed:** `assignee`, `expiration`, `id`, `keys` (author only),
`name`, `report`, `roster`.

**Not signed:** `certification`, `collected`, `seal`, `submission`,
`submitted`. These change after signing or are set by the student
(who does not have the symmetric key).

### Seal Integrity

Sealed submissions use a separate integrity mechanism. At submit
time, the SHA-256 hash of all ciphertexts (sorted by cell id,
joined with newline) is stored as `assignment.seal`. At unlock
time, `Workbook.unlock` recomputes this hash from the current
ciphertexts and compares. A mismatch fails the workbook.

### Transport Integrity (Plugin Responsibility)

Whole-file integrity of distributed workbook files is the
responsibility of the `Consumer` or `Collector` plugin at the
transport boundary. This cannot be solved inside the workbook
itself: a keyholder is always the source of authority over
workbook contents, so any in-rubric digest is self-signed
evidence with zero security value.

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
  private key, verifies the seal hash, and unseals each cell. The
  payload binding prevents cross-student replay (`assignee` check)
  and cell rearrangement (`id` check).

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
   `[keys.public.author, keys.public.assignee]`. The student key
   is stored via the unlocker's secrets manager.

5. **Revise** (`commands.ts: revise`, `Workbook.revise`): Student
   enters passphrase, derives key, decrypts their PGP private key,
   unseals all cells. Clears `seal`, `submission`, `submitted`, and
   student key fields. Defrosts the notebook.

6. **Grading** (`Workbook.unlock`): Validates metadata first
   (roster decryption, assignment signature) so that a tampered
   workbook never gets plaintext written. Then, if `assignment.seal`
   is non-null: decrypts the author PGP private key (local scope
   only), verifies the seal hash, and unseals each cell (checking
   `assignee` and `id` in each payload). Finally, decrypts
   reference cells.

### Payload Binding

Each sealed cell payload is `{ assignee, id, source, type }`. At
unseal time:

- `assignee` must match `assignment.assignee`. Prevents Student B
  from copying Student A's ciphertexts.
- `id` must match the cell id in the notebook. Prevents cell
  rearrangement after submission.
- `type` restores the original cell type (e.g. `code`, `markdown`)
  from `raw`.

Cross-assignment replay is not a concern: each rubric gets a fresh
random PGP keypair at authoring time, so ciphertext from one
assignment cannot be decrypted by another assignment's key.

### Post-Grading Plaintext

Graded notebooks are saved with student answers decrypted. The seal
protects the submission-to-grading corridor: answers are opaque on
disk while ungraded. After certification, the notebook is a feedback
receipt. Students need plaintext to review their scores and outputs.
Re-encrypting after grading would lock fire-and-forget students out
of their own feedback for no security gain.

### PGP Nondeterminism

PGP encryption uses random session keys. Encrypting the same
plaintext twice produces different ciphertext. The seal hash can
only be verified by hashing the existing ciphertexts, never by
re-encrypting and comparing.

## Lifecycle

### Assignment Fields

| Field           | Type             | Signed? | Meaning                              |
| --------------- | ---------------- | ------- | ------------------------------------ |
| `assignee`      | `string`         | Yes     | Student identifier                   |
| `roster`        | `string[]`       | Yes     | Encrypted on lock                    |
| `expiration`    | `number \| null` | Yes     | Deadline                             |
| `id`            | `string \| null` | Yes     | External assignment id               |
| `keys`          | `Keys`           | Partial | Author keys signed, student keys not |
| `name`          | `string`         | Yes     | Assignment display name              |
| `report`        | `Report`         | Yes     | Scores + interventions               |
| `seal`          | `string \| null` | No      | SHA-256 of concatenated ciphertexts  |
| `signature`     | `string`         | -       | The signature itself                 |
| `certification` | `number \| null` | No      | When the grade was finalized         |
| `submission`    | `number \| null` | No      | When the student submitted           |
| `submitted`     | `string \| null` | No      | External submission receipt          |
| `collected`     | `string \| null` | No      | External collection receipt          |

### Certification Sequence

1. `correct()` - execute cells, compute scores, sign report
   if all cells resolve
2. `certify()` - write certification timestamp
3. `lock()` - encrypt reference cells and roster, erase key
4. `freeze()` - set cells to non-editable

A workbook cannot be collected without a non-null `certification`.

### Verification

- `Assignment.validate({ assignment, key })` - structural checks:
  assignee must appear in roster, signature must be valid if
  assignee or roster exists, author keys must be present, sealed
  assignments must have an author public key, assignee private key
  requires a corresponding public key.

## Serialization Invariant

All optional fields use `Type | null`, never `Type?`. This ensures
`JSON.stringify` output is deterministic. `null` is serialized,
`undefined` is omitted. Since signatures hash stringified JSON,
field presence must be stable.

## Known Limitations

1. **Client-side only.** A technically sophisticated student could
   modify extension code in-browser to bypass locking or encryption.
   The cryptographic mechanisms detect tampering after the fact.

2. **No separation of duties.** The author holds the key and
   can perform any operation. There is no independent audit role.
