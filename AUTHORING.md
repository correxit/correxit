# Authoring a workbook

This guide is for the person writing the assignment. It explains how to
turn a Jupyter notebook into a Correxit workbook that can be distributed,
completed by students, and graded, all without a backend.

Everything a student receives is contained in a single `.ipynb` file.
Everything the grader needs is too. There is no database, no server, no
external state.

## Thinking in question–answer pairs

A well-authored workbook reads like a conversation: a markdown cell poses
a question, the code cell immediately below is where the student answers.

```
┌──────────────────────────────────────────┐
│  ## Question 1                           │  ← markdown (read-only for students)
│  Select the first 10 rows of `genres`.   │
├──────────────────────────────────────────┤
│  select * from genres limit 10;          │  ← code: the graded cell
├──────────────────────────────────────────┤
│  -----BEGIN PGP MESSAGE-----             │  ← raw: encrypted reference (invisible)
│  ...                                     │
└──────────────────────────────────────────┘
```

When a human grader reviews a student's work, the Reviewer shows the
preceding markdown cell as context (the question) so the grader
never has to scroll back to remember what was asked. This only works
when the question cell is directly above the answer cell, so the
order matters.

Cells that are not part of the rubric (markdown, setup code, boilerplate)
become read-only after distribution. Students can only edit the cells
you explicitly mark for grading.

## Converting a notebook

Open any Jupyter notebook and click **Convert to a workbook assignment…**
in the Correxit sidebar. You will be asked for a passphrase. This
passphrase derives a symmetric encryption key that protects reference
cells and the roster. Choose something memorable; you will need it
every time you unlock the workbook.

The passphrase never leaves the browser. It is not stored in the
notebook, in settings, or anywhere on disk.

After conversion the notebook is a workbook. The sidebar switches from
a single button to the full authoring interface.

## Cell types

Every code cell you add to the rubric becomes one of four types. Each
type has a different grading strategy.

### Answerable

The student's output is compared to a cryptographic digest (SHA-256)
of the expected answer. You type the expected output when you configure
the cell; Correxit hashes it immediately and discards the plaintext.
The student cannot recover the answer from the hash.

Best for cells that produce short, deterministic textual output:
a number, a name, a single line of text.

**To create one:** select the code cell, click **Answer** in the sidebar,
and type the expected output in the prompt.

### Comparable

The student's output is compared structurally to the output of a
_reference cell_, another code cell in the notebook that produces the
correct answer. Both cells are executed during grading, and their last
output messages are compared (data payloads for rich output, or stream
content for text).

Best for cells that produce tables, charts, or structured data where a
hash would be too brittle.

**To create one:** select the code cell, click **Compare**, then click on
the reference cell in the notebook. The reference is linked and marked
secret by default.

### Correctable

Like comparable, but each reference cell is a _test_: an assertion or
check that passes (no error) or fails (raises an error). A correctable
cell can have multiple references, each worth a fraction of the total
points.

Best for cells where correctness is better expressed as a suite of
checks rather than a single expected output.

**To create one:** select the code cell, click **Correct**, then click
on the test cell. Add more references with **Add a reference cell…** in
the sidebar.

### Reviewable

No automated grading. The cell is flagged for manual review by an
author using the Reviewer interface. The grader sees the cell source
and output, assigns a score, and optionally leaves a comment.

Best for open-ended responses, proofs, written analysis, or anything
that requires human judgment.

**To create one:** select any cell and click **Manual** in the sidebar.

## Reference cells

Comparable and correctable cells depend on reference cells. A reference
is an ordinary code cell in the notebook that you link to a graded cell.

References have two modes, toggled via the **Share** button in the sidebar:

| Mode       | During authoring  | After distribution                 |
| ---------- | ----------------- | ---------------------------------- |
| **Secret** | Visible, editable | Encrypted (PGP), hidden, read-only |
| **Shared** | Visible, editable | Visible, read-only                 |

Secret is the default. Use it when the reference reveals the answer
(e.g., the correct SQL query). Use shared when the reference is not
sensitive (e.g., a unit test that the student should be able to read).

A reference cell cannot also be a graded cell. A cell is either in the
rubric or it is a reference, never both.

### Correctable references and partial credit

Each reference on a correctable cell carries its own point value. The
cell's total possible score is the sum of its reference points. You can
adjust individual reference weights in the sidebar.

For example, a correctable cell with three test references at 2, 1, and
1 points has a total of 4 possible points. If only the first two tests
pass, the student earns 3.

## Points

Every graded cell has a point value. The default is 1. Change it by
editing the **Points possible** field in the sidebar.

For comparable cells, points are set directly on the cell. For
correctable cells, points are derived from the sum of reference weights;
you adjust them per-reference, not on the cell itself.

## Notebook structure

### Recommended layout

```
markdown       Question or instructions
code           Student answer (graded cell)
code/raw       Reference cell, if needed (secret or shared)

markdown       Next question
code           Next answer
...

code           Setup/boilerplate (not graded, read-only for students)
```

There are no hard structural requirements other than:

1. **Reference cells must exist in the notebook.** They must be code
   cells (or raw cells, but only after encryption on lock).
2. **A cell is either graded or a reference, not both.**
3. **Answerable cells need a payload.** If you create one, you must
   provide the expected output.

But there are conventions that produce better results:

- **Place the question markdown cell directly above the answer cell.**
  The Reviewer uses this position to show the grader what was asked.
  If there is no adjacent markdown cell, or the adjacent cell is itself
  graded or a reference, the grader sees no question context.

- **Place reference cells near their graded cell.** During single-cell
  correction, the notebook is executed from the top down to whichever
  comes later: the graded cell or its furthest reference. If a reference
  is far below, every code cell in between executes too, including
  other students' answer cells, which may error or produce side effects
  that pollute kernel state.

  Do not drag all reference cells to the bottom of the notebook. A
  reference at row 20 for a graded cell at row 3 means rows 4–19 all
  execute during single-cell correction of row 3. Keep each reference
  close to (ideally directly after) its graded cell.

- **Use setup cells at the top for shared state.** Database connections,
  imports, data loading. These are cells that every student needs but should not
  edit. These automatically become read-only for students.

## Testing

Before distributing, test the workbook by clicking **Correct workbook…**
in the sidebar. This executes the entire notebook against a kernel, scores
every cells, and reports the total. Every graded cell should show a
green checkmark.

You can also test individual cells with **Correct cell…** to iterate
quickly while authoring.

If a cell scores incorrectly, the sidebar shows the error code and the
cell is decorated with a red indicator. Common causes:

- The reference cell has a bug.
- The answerable cell's expected output does not match what the cell
  actually prints (whitespace, trailing newlines, encoding).
- A comparable cell's output structure changed (e.g., a library update
  changed the display format).

## Assignment and distribution

### Assigning

Open the workbook, enter a **roster** (list of student identifiers, one
per line) and an **assignment name** in the sidebar. If a Registrar
plugin is configured (e.g., Moodle), roster and assignment metadata are
fetched automatically.

### Propagating

Click **Create _N_ assigned workbooks…** to distribute. Correxit creates
one copy per roster entry:

1. Secret references are encrypted.
2. Non-graded cells are marked read-only.
3. The rubric is locked and the passphrase is stripped.
4. Each copy is signed with the student's identity.
5. The roster is encrypted so students cannot see classmates.

The Consumer plugin determines where files are written (local directory,
Moodle, etc.).

### Cell outputs and propagation

When Correxit creates assigned copies, it serializes the notebook as-is.
Cell outputs are **not** cleared. Any output present in your workbook at
propagation time ships to the student.

This means:

- If a graded cell still has your test output, the student sees it
  before writing a single line of code.
- If a secret reference cell has output (e.g., the correct query result),
  that output is **not** encrypted; only the source is. The student can
  read the output even though the code is hidden.

Treat outputs as intentional content. If an output is in the distributed
notebook, it should be there because you want the student to see it
(e.g., a sample result in a setup cell, or an expected-output preview in
a shared reference). If you do not want students to see an output, clear
it before propagating: **Edit → Clear All Outputs**, or clear individual
cells manually.

### What students receive

A locked notebook where:

- Markdown and setup cells are **visible but not editable**.
- Graded cells are **editable**: these are the blanks to fill in.
- Secret references appear as **encrypted raw cells** (PGP blocks, hidden source).
- Shared references are **visible but not editable**.
- The passphrase is absent. Students cannot unlock the workbook.

Double-clicking a read-only markdown cell will not switch it to edit mode
(Correxit disables this per-notebook to avoid confusing students).

## Locking and unlocking

| Action     | What happens                                                     |
| ---------- | ---------------------------------------------------------------- |
| **Lock**   | Encrypts secret references, encrypts roster, erases the key.     |
| **Unlock** | Prompts for passphrase, decrypts references, re-enables editing. |

Lock before distributing. You can lock and unlock freely during
authoring to preview what students will see.

### Draft

If a student has submitted but needs to revise, reverted copies recover
an editable state (answer cells become editable again, lifecycle
timestamps are cleared) while keeping the rubric locked. The student
does not need the passphrase.

## Lifecycle

A workbook moves through these stages:

```
                         ┌───────────┐
        convert ───────▸ │ Unlocked  │ ◂── unlock
                         └─────┬─────┘
                               │ lock
                         ┌─────▼─────┐
                         │  Locked   │ ◂── draft
                         └─────┬─────┘
                               │ submit
                         ┌─────▼─────┐
                         │ Submitted │
                         └─────┬─────┘
                               │ certify
                         ┌─────▼─────┐
                         │ Certified │
                         └─────┬─────┘
                               │ collect
                         ┌─────▼─────┐
                         │ Collected │
                         └───────────┘
```

- **Submitted**: the student clicked submit (or the Submitter plugin
  recorded it). A timestamp is stored.
- **Certified**: the grade has been computed and frozen. Certification
  is the grader's seal; it requires all cells to be scored.
- **Collected**: an external system (Collector plugin) acknowledged
  receipt of the grade.

## Tips

- **One passphrase per workbook.** The passphrase is bound to the rubric
  ID. You cannot change it after conversion.
- **Test early, test often.** Run Correct after every change. A small
  drift in expected output can silently break answerable cell scoring.
- **Answerable cells are fragile.** A trailing newline, a different
  locale, a library update that changes formatting. Any of these will
  invalidate the digest. Prefer comparable or correctable cells when
  output is not perfectly deterministic.
- **Correctable cells are the most robust.** Tests that assert properties
  of the output are more resilient than exact-match comparisons.
- **Reviewable cells are the escape hatch.** When automated scoring is
  impractical, use reviewable. The grader can assign any score from 0 to
  the cell's possible points.
- **Student code cannot break grading.** The batch grader has a
  configurable per-workbook timeout. If a student's code hangs, runs an
  infinite loop, or crashes the kernel, that workbook times out and the
  grader moves on. The timeout, concurrency limit, and retry count are
  all configurable in the Corrector settings. You do not need to
  defensively design around pathological submissions.
- **Keep the notebook self-contained.** Everything the student needs
  (data files, imports, context) should be in the notebook or its
  working directory. There is no server-side setup step.
- **Clear outputs before propagating.** Unless you intentionally want
  students to see a cell's output, clear all outputs before distributing.
  Outputs are not encrypted, even on secret reference cells.
