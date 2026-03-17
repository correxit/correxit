# Correxit Plugin Integration

Correxit is serverless by design. All assignment distribution, submission
recording, and grade collection are delegated to **plugin tokens** that a
server-backed JupyterLab extension can satisfy. The five integration points
are described below.

`Unlocker` and `Monitor` are also plugin tokens but have sensible defaults
and are rarely overridden. `Monitor` is an internal concern. `Unlocker` is
documented below for institutional deployments that manage keys externally.

---

## `Workbook.Identifier`

Most plugins receive a `Workbook.Identifier`, which provides the core correlation identity for a workbook state:

```typescript
type Identifier = {
  // The assigned student's identifier, if any.
  assignee: string | null;
  // The external assignment ID used for LMS correlation.
  assignment: string | null;
  // The immutable rubric ID shared by all workbooks.
  rubric: string;
  // A content hash that changes when the assignment materially changes.
  signature: string | null;
};
```

Plugins that operate on _assigned_ workbooks (consumer, submitter) receive
`Identifier.Assigned`, which narrows `assignee` and `signature` to `string`:

```typescript
type Assigned = Identifier & { assignee: string; signature: string };
```

A type guard `Identifier.assigned(id)` bridges the two at runtime.

An integrator uses these fields to look up a course, validate submission
integrity, enforce deadlines, or record a grade to an external gradebook.

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

The integrator relies on the `identifier` values to fetch available
course roster and assignment metadata.

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
  identifier: Workbook.Identifier.Assigned;
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
  identifier: Workbook.Identifier.Assigned
) => Promise<string | null>;
```

Called when a student submits a workbook. Returns an opaque submission receipt
that Correxit stores in the workbook metadata, or `null` if the submission
was not recorded. The identifier is guaranteed to have a non-null `assignee`
and `signature`.

The default implementation returns a random UUID. A server-backed submitter
would POST the submission to an LMS, validate the assignee against the
roster, enforce the deadline, and return the server-issued receipt ID.

---

## `Correxit.Collector`

```typescript
type Collector = (certified: Workbook.Certified) => Promise<string | null>;
```

Called by the corrector after a workbook has been graded and certified.
Returns an opaque receipt that Correxit stores in the workbook
metadata, or `null` if the grade was not recorded.

```typescript
// Workbook.Certified
type Certified = {
  grade: Workbook.Grade;
  identifier: Workbook.Identifier.Assigned;
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
server-issued receipt ID.

---

## `Correxit.Unlocker`

```typescript
type Unlocker = {
  store(id: string, key: string): Promise<void>;
  unlock(
    workbook: Workbook,
    credentials: Partial<Workbook.Credentials & { silent: boolean }> | null
  ): Promise<Rubric.Unlocked | null>;
};
```

Manages the rubric key lifecycle. `store` persists a key for a rubric id
(in memory only; keys must never reach disk). `unlock` attempts to unlock
a workbook, optionally prompting the user for credentials.

The default implementation uses the JupyterLab `SecretsManager`. An
institutional deployer might replace it with an HSM-backed or
vault-backed provider that supplies keys without user interaction.

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
    const receipt = await myLms.submit(
      identifier.assignment,
      identifier.assignee
    );
    return receipt ?? null;
  }
};
```

---

## Moodle Integration

Correxit includes built-in Moodle plugins for the **registrar** (assignment
metadata and rosters) and **consumer** (distributing workbooks to students
via the Moodle file and submission APIs). Both operate via the Moodle REST
API and require some one-time setup by a Moodle administrator.

The integration uses two moving parts:

1. A **Moodle external service** with a curated set of web service functions.
2. An **API token** scoped to that service and assigned to a teacher account.

The teacher enters their Moodle server URL and token in the Correxit
registrar settings (Settings → Correxit Registrar → Moodle). Correxit then
fetches the teacher's courses, assignments, and enrolled students directly
from the browser. No backend required.

### Administrator setup

These steps are performed once by whoever administers the Moodle instance.

#### 1. Enable web services

- **Site administration → Advanced features**: check _Enable web services_.
- **Site administration → Server → Web services → Manage protocols**:
  enable _REST protocol_.

#### 2. Create the external service

- **Site administration → Server → Web services → External services →
  Add**.
- Name it **Correxit** (or any name your institution prefers).
- Check _Enabled_. Leave _Authorised users only_ unchecked unless you want
  to maintain an explicit allowlist.
- Check **Can upload files** and **Can download files**.

#### 3. Add functions to the service

Open the Correxit service and add the functions listed below. This list
tracks exactly what the current Correxit code calls, nothing more.

| Function                        | Used by                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `mod_assign_get_assignments`    | Registrar: lists assignments the teacher can see         |
| `core_enrol_get_enrolled_users` | Registrar & Consumer: fetches the roster / user IDs      |
| `core_grades_update_grades`     | Consumer: sets the assignment's maximum grade            |
| `mod_assign_save_grade`         | Consumer: attaches the notebook as feedback per student  |

The external service must also have **Can upload files** and
**Can download files** enabled (checkboxes on the service edit page).
The consumer uploads each workbook notebook to the Moodle draft area
before attaching it to the student's submission.

#### 4. Create a token for the teacher

A token must be created by an account with the _moodle/webservice:createtoken_
capability (typically an admin) and assigned to the teacher's account.

- **Site administration → Server → Web services → Manage tokens → Create
  token**.
- Select the **teacher's user account**.
- Select the **Correxit** service.
- Optionally set an expiry date.

Give the resulting token to the teacher. The teacher will paste it into
Correxit's settings; it is never written to disk by Correxit.

#### 5. Configure CORS

Because Correxit runs entirely in the browser, the Moodle server must return
CORS headers that allow requests from the origin where JupyterLab is served
(e.g. `http://localhost:8888`).

How you achieve this depends on your deployment:

- **Apache**: add an `Access-Control-Allow-Origin` header to the
  webservice endpoint via a `.conf` snippet or `.htaccess`.
- **Nginx reverse proxy**: add the header in the `location` block that
  proxies to Moodle.
- **Docker (moodle-docker)**: mount a CORS config file into the Apache
  container. The `local.yml` override in the moodle-docker repo is one way.

A wildcard (`*`) is acceptable for development. In production, restrict the
origin to the domain that serves your Jupyter environment.

### Teacher setup

Once the administrator has completed the steps above and provided a token:

1. Open JupyterLab.
2. **Settings → Settings Editor → Correxit Registrar**.
3. Set **Provider** to `moodle`.
4. Enter the **Moodle URL** (e.g. `https://moodle.example.edu`).
5. Paste the **API token**.
6. **Settings → Settings Editor → Correxit Consumer**.
7. Set **Provider** to `moodle`.
8. Enter the same **Moodle URL** and **API token**.

The registrar and consumer maintain independent settings and secrets so
that each can be configured (or disabled) separately.

When the teacher opens a workbook that has not yet been assigned, Correxit
will fetch their courses and assignments from Moodle and present them in a
dropdown.

### Assignment ID convention

The Moodle registrar encodes the assignment `id` as `courseId:assignmentId`
(e.g. `2:5`). The Moodle consumer parses this compound ID to directly look
up the course's enrolled users without re-fetching all assignments. Other
LMS integrations may adopt a similar colon-delimited convention. Registrars
that do not use an LMS (e.g. manual mode) store a plain opaque string;
the core treats `id` as `string | null` and never interprets it.

### Minimum permissions

The teacher account needs the standard **editingteacher** role in each
course they teach. No additional capabilities beyond the role defaults are
required. The web service functions above operate within the teacher's
normal course-level permissions.

The token and external service are administrative objects; the teacher does
not need admin access to _use_ a token, only to _create_ one.

### Troubleshooting

| Symptom                        | Likely cause                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Dropdown is empty              | The token user has no courses with assignments, or the external service is missing a function. |
| Network error / CORS           | Moodle is not returning `Access-Control-Allow-Origin` for the JupyterLab origin.               |
| `Invalid token`                | Token is expired, revoked, or pasted incorrectly.                                              |
| Students missing from roster   | The student is not enrolled in the course, or their enrolment is suspended.                    |
| `Upload failed` / access error | The external service does not have **Can upload files** enabled.                               |
| `mod_assign_save_grade`        | The function is not added to the external service's function list.                             |
| `No Moodle user for …`         | The assignee string in the roster does not match any Moodle `username`.                        |
| `Invalid assignment ID format` | The workbook was registered with the manual registrar, not the Moodle one.                     |
