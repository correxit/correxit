# Correxit Plugin Integration

Correxit is serverless by design. Distribution, submission recording, and
grade collection are delegated to plugin tokens that a JupyterLab extension
can provide.

The main external integration points are `Registrar`, `Distributor`,
`Submitter`, and `Collector`.

`Unlocker` and `Monitor` are also tokens. `Monitor` is internal. `Unlocker`
is relevant only for deployments that manage keys externally.

---

## `Workbook.Identifier`

Most plugins receive `Workbook.Identifier`, the stable correlation identity
for a workbook state:

```typescript
type Identifier = {
  // The assigned student's identifier, if any.
  assignee: string | null;
  // The external assignment ID used for LMS correlation.
  assignment: string | null;
  // The issued blank-slate digest, if propagation has occurred.
  issue: string | null;
  // The immutable rubric ID shared by all workbooks.
  rubric: string;
};
```

Plugins that operate on assigned workbooks receive
`Identifier.Assigned`, which narrows `assignee` to `string`:

```typescript
type Assigned = Identifier & { assignee: string };
```

`Identifier.assigned(id)` narrows at runtime.

Integrators use these fields to look up courses, enforce deadlines, and record
submissions or grades externally.

`Identifier` intentionally does **not** include `assignment.mac`. The MAC is a
local integrity proof over broader author-controlled state, not a routing key.
Plugins need a stable lookup identity. Correxit verifies the MAC internally.

---

## `Correxit.Registrar`

```typescript
type Registrar = (
  workbook: Workbook,
  identifier: Workbook.Identifier
) => Promise<
  | Rubric.Assignment.Registration[]
  | { group: string; assignments: Rubric.Assignment.Registration[] }[]
  | null
>;
```

Called when an author opens an unassigned workbook. Returns available
assignment registrations.

```typescript
// Rubric.Assignment.Registration
type Registration = Pick<
  Rubric.Assignment,
  'expiration' | 'id' | 'name' | 'roster'
>;
```

| Return value     | Effect                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `null`           | Assignment input is unlocked; the author may enter details manually.                                           |
| `[]`             | Assignment input is locked; the assignment has no eligible registrations.                                      |
| `Grouped[]`      | Assignment input is locked; registrations are shown under group headings.                                      |
| `Registration[]` | Assignment input is locked; a single registration is auto-selected, multiple registrations present a dropdown. |

Integrators use the `identifier` to fetch roster and assignment metadata.

---

## `Correxit.Distributor`

```typescript
type Distributor = (propagated: {
  identifier: Workbook.Identifier.Assigned;
  notebook: INotebookContent;
  path: string;
}) => Promise<void>;
```

Called when an author propagates a workbook or retries delivery for one saved
workbook. The distributor receives:

- `propagated` - one personalized notebook ready for delivery.

```typescript
type Propagated = {
  identifier: Workbook.Identifier.Assigned;
  notebook: INotebookContent; // nbformat notebook, ready to save
  path: string; // intended destination path
};
```

The distributor is responsible only for delivery (LMS upload, object store,
etc.). Local file creation stays in the core propagator. After successful
delivery, Correxit records the local `assignment.distribution` timestamp.

> The default distributor is the manual distributor, which is a no-op.

---

## `Correxit.Submitter`

```typescript
type Submitter = (
  workbook: Workbook,
  identifier: Workbook.Identifier.Assigned
) => Promise<string | null>;
```

Called when a student submits a workbook. Returns an opaque receipt that
Correxit stores in workbook metadata, or `null` if the submission was not
recorded. `assignee` is guaranteed non-null.

The default implementation returns a content-addressed digest receipt. A
server-backed submitter would POST the submission to an LMS, validate the
assignee against the roster, enforce the deadline, and return the server's
receipt.

---

## `Correxit.Collector`

```typescript
type Collector = (certified: Workbook.Certified) => Promise<string | null>;
```

Called after a workbook has been graded and certified. Returns an opaque
receipt that Correxit stores in workbook metadata, or `null` if the grade was
not recorded.

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

The default implementation returns a content-addressed digest receipt. A
server-backed collector would POST the grade to the gradebook, correlate the
workbook via the identifier, and return the server's receipt.

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

Manages the rubric key lifecycle. `store` persists a key for a rubric id in
memory only. `unlock` attempts to unlock a workbook, optionally prompting for
credentials.

The default implementation uses JupyterLab `SecretsManager`. Institutional
deployments may replace it with an HSM-backed or vault-backed provider.

---

## Providing a plugin

Each token is a standard Lumino `Token<T>`. Override a default by declaring a
`JupyterFrontEndPlugin` that `provides` the token:

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
metadata and rosters) and **distributor** (delivery to students via Moodle
file and submission APIs). Both use the Moodle REST API and need one-time
administrator setup.

The integration needs two things:

1. A **Moodle external service** with a curated set of web service functions.
2. An **API token** scoped to that service and assigned to a teacher account.

The teacher enters the Moodle URL and token in Correxit settings. Correxit
then fetches courses, assignments, and enrolled students directly from the
browser. No backend is required.

### Administrator setup

These steps are performed once by the Moodle administrator.

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

Open the Correxit service and add the functions below. This list matches the
current Correxit code exactly.

| Function                        | Used by                                                |
| ------------------------------- | ------------------------------------------------------ |
| `mod_assign_get_assignments`    | Registrar: lists assignments the teacher can see       |
| `core_enrol_get_enrolled_users` | Registrar & Distributor: fetches the roster / user IDs |
| `core_grades_update_grades`     | Distributor: sets the assignment's maximum grade       |
| `mod_assign_save_grade`         | Distributor: attaches the notebook as feedback         |

The external service must also have **Can upload files** and
**Can download files** enabled (checkboxes on the service edit page).
The distributor uploads each workbook notebook to the Moodle draft area
before attaching it to the student's feedback.

#### 4. Create a token for the teacher

A token must be created by an account with the _moodle/webservice:createtoken_
capability, typically an admin, and assigned to the teacher's account.

- **Site administration → Server → Web services → Manage tokens → Create
  token**.
- Select the **teacher's user account**.
- Select the **Correxit** service.
- Optionally set an expiry date.

Give the resulting token to the teacher. Correxit does not write it to disk.

#### 5. Configure CORS

Because Correxit runs entirely in the browser, Moodle must return CORS headers
that allow requests from the JupyterLab origin (for example
`http://localhost:8888`).

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
6. **Settings → Settings Editor → Correxit Distributor**.
7. Set **Provider** to `moodle`.
8. Enter the same **Moodle URL** and **API token**.

Registrar and distributor settings are independent, so each can be configured
or disabled separately.

When the teacher opens an unassigned workbook, Correxit fetches courses and
assignments from Moodle and presents them in a dropdown.

### Assignment ID convention

The Moodle registrar encodes the assignment `id` as `courseId:assignmentId`
(for example `2:5`). The Moodle distributor parses this compound id to look
up enrolled users without re-fetching all assignments. Other LMS integrations
may adopt a similar convention. Registrars that do not use an LMS store any
opaque string; the core treats `id` as `string | null` and does not interpret
it.

### Minimum permissions

The teacher account needs the standard **editingteacher** role in each course.
No additional capabilities beyond the role defaults are required. The token
and external service are administrative objects; the teacher needs admin
access to create a token, not to use one.

Propagation progress is a private UI concern. Integrators do not implement a
streaming progress API.

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
