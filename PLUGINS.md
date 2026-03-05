# Correxit Plugin Integration

Correxit is serverless by design. All assignment distribution, submission
recording, and grade collection are delegated to **plugin tokens** that a
server-backed JupyterLab extension can satisfy. The four integration points
are described below.

---

## `Correxit.Registrar`

```typescript
type Registrar = (
  workbook: Workbook,
  identifier: Workbook.Identifier
) => Promise<Rubric.Assignment.Registration[] | null>;
```

Called when an instructor opens a workbook that has not yet been assigned.
Returns assignment registrations for the workbook.

```typescript
// Rubric.Assignment.Registration
type Registration = Pick<
  Rubric.Assignment,
  'expiration' | 'id' | 'name' | 'roster'
>;
```

| Return value     | Effect                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `null`           | Assignment input is unlocked; the instructor may enter details manually.                                       |
| `[]`             | Assignment input is locked; the assignment has no eligible registrations.                                      |
| `Registration[]` | Assignment input is locked; a single registration is auto-selected, multiple registrations present a dropdown. |

The `identifier` carries the external `assignment` id (from the
registration), the immutable `rubric` id, and the workbook `signature`
(a hash of the assignee, roster, report, and registration fields). An
integrator can use these to look up a course in an LMS and return its
available assignments.

---

## `Correxit.Consumer`

```typescript
type Consumer = (output: {
  path: string;
  rubric: Rubric.Unlocked;
  stream: Propagator;
}) => AsyncGenerator<Emitter.Emission>;
```

Called when an instructor triggers propagation. The consumer receives:

- `path` - the source notebook path.
- `rubric` - the unlocked rubric, including the resolved roster.
- `stream` - a factory that, given `{ base, pwd }`, returns an async
  iterable of personalized notebook objects ready for delivery.

```typescript
// Propagator.Notebook
type Notebook = {
  identifier: Workbook.Identifier; // { assignee, assignment, rubric, signature }
  notebook: INotebookContent; // nbformat notebook, ready to save
  path: string; // intended destination path
};
```

The consumer is responsible for delivering each notebook to its destination
(file system, LMS upload, object store, etc.) and `yield`-ing
`Emitter.Emission` values - `{ type: string; slots: (string | number)[] }`

- to drive the progress UI.

> The default consumer writes workbooks to a local subdirectory. A
> server-backed consumer would iterate `stream` and POST each notebook to
> an LMS endpoint.

---

## `Correxit.Submitter`

```typescript
type Submitter = (
  workbook: Workbook,
  identifier: Workbook.Identifier
) => Promise<string | null>;
```

Called when a student submits a workbook. Returns an opaque submission ID
that Correxit stores in the workbook metadata, or `null` if the submission
was not recorded.

The default implementation returns a random UUID. A server-backed submitter
would POST the submission to an LMS, validate the assignee against the
roster, enforce the deadline, and return the server-issued submission ID.

`identifier` at call time:

- `assignee` - the student's address as recorded in the workbook.
- `assignment` - the external assignment id used for LMS/backend
  correlation.
- `rubric` - the immutable rubric id shared across all workbooks for
  this assignment.
- `signature` - a content hash that changes whenever the assignee,
  roster, report, or registration fields change.

---

## `Correxit.Collector`

```typescript
type Collector = (certified: Workbook.Certified) => Promise<string | null>;
```

Called by the corrector after a workbook has been graded and certified.
Returns an opaque collection ID that Correxit stores in the workbook
metadata, or `null` if the grade was not recorded.

```typescript
// Workbook.Certified
type Certified = {
  grade: Workbook.Grade;
  identifier: Workbook.Identifier;
  workbook: Workbook;
};

// Workbook.Grade
type Grade = {
  path: string; // workbook file path
  resolved: boolean; // true if all reviewable cells were reviewed
  score: Rubric.Score; // final score summary
  spec: KernelSpec.ISpecModel | null; // kernel used for correction
};
```

The default implementation returns a random UUID. A server-backed collector
would POST the grade to the gradebook, verify the signature, and return the
server-issued record ID.

---

## Providing a plugin

Each token is a standard Lumino `Token<T>`. Override the default
implementation by declaring a `JupyterFrontEndPlugin` that `provides` the
token:

```typescript
import { JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Correxit } from '@quantstack/correxit';

const submitter: JupyterFrontEndPlugin<Correxit.Submitter> = {
  id: 'my-lms:submitter',
  provides: Correxit.Submitter,
  autoStart: true,
  activate: () => async (workbook, identifier) => {
    const id = await myLms.submit(identifier.assignment, identifier.assignee);
    return id ?? null;
  }
};
```
