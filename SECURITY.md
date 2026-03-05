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
| Tampered workbook delivery           | Out-of-band (Consumer/Collector plugin hashing)        |

**Out of scope:** malicious instructors (they hold the key, full
authority by design), browser memory extraction, compromised
JupyterLab servers (Correxit has no backend), and cross-student
file access (students reading each other's workbooks is a file
system or LMS access-control concern, not solvable in-workbook).

## Key Management

Keys are **never written to disk**. They exist only in closure
scope and enter via user input, dying with the browser tab. The
`Rubric.Unlocked` type carries the key; `Rubric.Locked` has
`key: null`. Notebook metadata only stores locked rubrics, the key
is structurally absent from anything on disk.

## Integrity

### Assignment Signature

Signs the **terms** of the assignment: `assignee`, `expiration`, `id`,
`name`, `report` (interventions + scores, sorted), and `roster`.

```
signature = SHA-256(JSON.stringify(terms) + key)
```

This is a keyed hash. The key is appended, which avoids length-extension
concerns.

Proves the assignment contract is authentic. Any modification to
these fields invalidates the signature.

**Not signed:** lifecycle timestamps (`certification`, `submission`)
and receipts (`collected`, `submitted`). These change after signing
and are administrative. Including them would couple every lifecycle
event to key availability.

### Transport Integrity (Plugin Responsibility)

Whole-file integrity of distributed workbook files is the
responsibility of the `Consumer` or `Collector` plugin at the
transport boundary. This cannot be solved inside the workbook
itself: a keyholder is always the source of authority over
workbook contents, so any in-rubric digest is self-signed
evidence with zero security value.

## Encryption

- **Reference cells:** `comparable` and `correctable` cells marked
  `secret: true` have their reference cells encrypted with the
  assignment key on lock. Students cannot read secret reference
  answers without the key. Cells marked `secret: false` leave
  reference cells visible (useful when the reference is not
  sensitive, e.g. a unit test).
- **Roster:** Encrypted with the assignment key on lock. Students
  cannot enumerate the roster.
- **Answerable cells:** Store a SHA-256 digest of the expected
  output, not the output itself. One-way; the answer cannot be
  recovered.

## Lifecycle

### Assignment Fields

| Field           | Type             | Signed? | Meaning                      |
| --------------- | ---------------- | ------- | ---------------------------- |
| `assignee`      | `string`         | Yes     | Student identifier           |
| `roster`        | `string[]`       | Yes     | Encrypted on lock            |
| `expiration`    | `number \| null` | Yes     | Deadline                     |
| `id`            | `string \| null` | Yes     | External assignment id       |
| `name`          | `string`         | Yes     | Assignment display name      |
| `report`        | `Report`         | Yes     | Scores + interventions       |
| `signature`     | `string`         | -       | The signature itself         |
| `certification` | `number \| null` | No      | When the grade was finalized |
| `submission`    | `number \| null` | No      | When the student submitted   |
| `submitted`     | `string \| null` | No      | External submission receipt  |
| `collected`     | `string \| null` | No      | External collection receipt  |

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
  assignee or roster exists.

## Serialization Invariant

All optional fields use `Type | null`, never `Type?`. This ensures
`JSON.stringify` output is deterministic - `null` is serialized,
`undefined` is omitted. Since signatures hash stringified JSON,
field presence must be stable.

## Known Limitations

1. **Client-side only.** A technically sophisticated student could
   modify extension code in-browser to bypass locking or encryption.
   The cryptographic mechanisms detect tampering after the fact.

2. **No separation of duties.** The instructor holds the key and
   can perform any operation. There is no independent audit role.
