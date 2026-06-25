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

- `null`: assignment input stays unlocked. The author may enter details
  manually.
- `[]`: assignment input is locked and there are no eligible
  registrations.
- `Grouped[]`: assignment input is locked and registrations are shown
  under group headings.
- `Registration[]`: assignment input is locked. A single registration is
  auto-selected. Multiple registrations produce a dropdown.

Integrators use the `identifier` to fetch roster and assignment metadata.

---

## `Correxit.Distributor`

```typescript
type Resource = { name: string; data: Uint8Array };

type Distributor = (propagated: {
  identifier: Workbook.Identifier.Assigned;
  notebook: INotebookContent;
  path: string;
  resources: Resource[] | null;
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
  resources: Resource[] | null; // sidecar files, loaded by the propagator
};
```

`resources` is `null` when no sidecar files were declared on the assignment.
Otherwise each entry carries the file name and raw bytes. The distributor is
responsible for any external delivery of the notebook and resources. The core
propagator creates the local notebook and sidecar files, then records
`assignment.distribution` after successful delivery.

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

This is the authority boundary: a submitter receipt can carry the upstream
system's clock, rules, and acceptance decision. Correxit's own local
`submission` timestamp cannot do that by itself.

A strong submitter should bind the accepted bytes, assignee, assignment
identifier, and acceptance time in the external system. The receipt stored in
the workbook is an opaque pointer to that authority.

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

Correxit does not store rubric keys in notebook metadata, settings JSON, or
assignment files. The configured `Unlocker` is the key-custody boundary. The
bundled secrets-manager connector is in-memory; a persistent connector is a
deployment choice.

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
metadata and rosters), **distributor** (delivery to students via Moodle
feedback attachments), and **collector** (posting certified grades back to
Moodle with the graded notebook attached). All three use the Moodle REST API
and need one-time administrator setup.

For the operational teacher and student workflow, including the browser-only
constraints that shape it, see [MOODLE](MOODLE.md).

The built-in **submitter** is manual. Because Correxit runs entirely in the
browser using the teacher's API token, it cannot safely authenticate as a
student to submit work on their behalf. Students submit their assignments by
uploading their downloaded `.ipynb` files through the standard Moodle
assignment interface.

This also means Moodle, not Correxit, is the authority on late policy in that
integration. Correxit may preserve local submission state inside the notebook,
but Moodle's receipt and deadline rules are the ones that count.

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

- `mod_assign_get_assignments`: registrar lists assignments visible to the
  teacher.
- `core_enrol_get_enrolled_users`: registrar and distributor fetch the roster
  and Moodle user ids.
- `mod_assign_save_grade`: distributor attaches notebooks. Collector posts the
  scaled grade and graded notebook.
- `mod_assign_get_grades`: distributor checks to ensure reassignment only when
  requested.

The external service must also have **Can upload files** and
**Can download files** enabled (checkboxes on the service edit page).
The distributor uploads each workbook notebook to the Moodle draft area
before attaching it to the student's feedback. The collector uses the same
upload path for the graded workbook and records the numeric grade in the same
Moodle assignment.

#### 3a. Service permissions checklist

The registered Moodle external service must be granted all of the following:

- **Enabled**: the external service itself must be enabled.
- **REST protocol**: the REST protocol must be enabled globally.
- **Can upload files**: required because Correxit uploads notebooks to the
  Moodle draft area before attaching them to assignment feedback.
- **Can download files**: enable this alongside upload support on the service.
- **Function `mod_assign_get_assignments`**: required by the registrar to list
  assignments available to the teacher.
- **Function `core_enrol_get_enrolled_users`**: required by the registrar to
  build the roster and by the distributor/collector to resolve a Correxit
  assignee string to a Moodle user id.
- **Function `mod_assign_save_grade`**: required by the distributor to attach
  assigned notebooks as feedback files and by the collector to post the final
  scaled grade plus graded notebook.

Correxit does **not** currently call any other Moodle web service functions.
In particular, the built-in Moodle integration does not use a separate submit
API, and it does not call `core_grades_update_grades`.

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
9. **Settings → Settings Editor → Correxit Collector**.
10. Set **Provider** to `moodle`.
11. Enter the same **Moodle URL** and **API token**.

Registrar, distributor, and collector settings are independent, so each can be
configured or disabled separately.

When the teacher opens an unassigned workbook, Correxit fetches courses and
assignments from Moodle and presents them in a dropdown.

On distribution, Correxit attaches the assigned workbook to the student's
Moodle assignment feedback area. On collection, Correxit uploads the certified
workbook the same way and records the scaled numeric grade.

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

If your institution uses custom roles, ensure the token user can do the
following in each target course:

- view assignments returned by `mod_assign_get_assignments`
- view enrolled users returned by `core_enrol_get_enrolled_users`
- grade assignments via `mod_assign_save_grade`
- attach feedback files to those graded assignments

In practice, this means the token should normally belong to a teacher-grade
account, not a student or read-only service account.

Propagation progress is a private UI concern. Integrators do not implement a
streaming progress API.

### Troubleshooting

- **Dropdown is empty**: the token user has no courses with assignments,
  or the external service is missing a function.
- **Network error / CORS**: Moodle is not returning
  `Access-Control-Allow-Origin` for the JupyterLab origin.
- **`Invalid token`**: the token is expired, revoked, or pasted
  incorrectly.
- **Students missing from roster**: the student is not enrolled in the
  course, or the enrolment is suspended.
- **`Upload failed` / access error**: the external service does not have
  **Can upload files** enabled.
- **`mod_assign_save_grade`**: the function is not in the external
  service function list.
- **`No Moodle user for …`**: the assignee string in the roster does not
  match a Moodle `username`.
- **`Invalid assignment ID format`**: the workbook was registered with
  the manual registrar, not the Moodle one.
