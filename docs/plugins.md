# Correxit Plugin Integration

Correxit is serverless by design. Distribution, submission recording, and
grade collection are delegated to plugin tokens that a JupyterLab extension
can provide.

Plugin contracts are published as an independent, lightweight npm package:
`@correxit/contracts`. Plugin implementors should depend on `@correxit/contracts`
rather than the full `correxit` package. This decouples plugin authoring from
internal Correxit releases and dependencies.

The main external integration points are `Registrar`, `Distributor`,
`Submitter`, and `Collector`.

`Unlocker` is also provided for deployments that manage keys externally
(such as hosted services like `notebook.link`).

---

## Dependency Setup

Plugin packages should declare `@correxit/contracts` as a dependency and register
it as a shared singleton in `package.json`:

```json
{
  "dependencies": {
    "@correxit/contracts": "^1.0.0",
    "@lumino/coreutils": "^1.11.0 || ^2.1.1"
  },
  "jupyterlab": {
    "extension": true,
    "sharedPackages": {
      "@correxit/contracts": {
        "singleton": true
      }
    }
  }
}
```

This guarantees that both Correxit and your plugin share the exact same Lumino
service `Token` instances in the browser at runtime.

---

## `Identifier`

Most plugins receive `Identifier`, the stable correlation identity for a
workbook state:

```typescript
type Identifier = {
  // The assigned student's identifier, if any.
  assignee: string | null;
  // The external assignment ID used for LMS correlation.
  assignment: string | null;
  // Intended local file name of the notebook.
  file: string | null;
  // The issued blank-slate digest, if propagation has occurred.
  issue: string | null;
  // The immutable rubric ID shared by all workbooks.
  rubric: string;
};
```

Plugins that operate on assigned workbooks receive `Identifier.Assigned`, which
narrows `assignee` and `file` to non-null `string`:

```typescript
type Assigned = Identifier & { assignee: string; file: string };
```

`Identifier.assigned(id)` narrows at runtime.

Integrators use these fields to look up courses, enforce deadlines, and record
submissions or grades externally.

`Identifier` intentionally does **not** include `assignment.mac`. The MAC is a
local integrity proof over broader author-controlled state, not a routing key.
Plugins need a stable lookup identity. Correxit verifies the MAC internally.

---

## `Registrar`

```typescript
type Registrar = (
  identifier: Identifier
) => Promise<Registration[] | Registration.Group[] | null>;
```

Called when an author opens an unassigned notebook. Returns available
assignment registrations:

```typescript
type Registration = {
  expiration: number | null;
  id: string | null;
  name: string;
  roster: string[];
};

namespace Registration {
  type Group = {
    assignments: Registration[];
    group: string;
  };
}
```

- `null`: assignment input stays unlocked. The author may enter details
  manually.
- `[]`: assignment input is locked and there are no eligible
  registrations.
- `Group[]`: assignment input is locked and registrations are shown
  under group headings.
- `Registration[]`: assignment input is locked. A single registration is
  auto-selected. Multiple registrations produce a dropdown.

Integrators use `identifier` to fetch roster and assignment metadata.

---

## `Distributor`

```typescript
type Resource = { name: string; data: Uint8Array };

type Distributor = (propagated: Distributor.Payload) => Promise<boolean>;

namespace Distributor {
  type Payload = {
    identifier: Identifier.Assigned;
    notebook: Notebook; // structural JSON representation of the notebook
    overwrite: boolean; // true when the author explicitly requests re-delivery
    path: string; // intended destination path
    resources: Resource[] | null; // sidecar files, loaded by the propagator
  };
}
```

Called for each assignee during propagation, and again on a single-workbook
retry. The distributor receives one personalized notebook ready for delivery.

`resources` is `null` when no sidecar files were declared on the assignment.
Otherwise each entry carries the file name and raw bytes.

### Return value

The `boolean` return is feedback to the propagator:

| Return  | Meaning                                     | Propagator behaviour                                                                                                                                                     |
| ------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true`  | Delivered (or no external delivery needed). | Attempts to save the local notebook with `assignment.distribution` recorded; on success, emits a `distributed` event, and on local-save failure emits `create-error`.    |
| `false` | Skip this assignee intentionally.           | Skips writing the local file entirely and emits a `skipped` event. Use this to avoid overwriting an existing delivery when `overwrite` is `false`.                       |
| throws  | Delivery failed unexpectedly.               | Emits a `distribute-error` event, then attempts to save the local file for recovery without `assignment.distribution`; on local-save failure, also emits `create-error`. |

A distributor that does not interact with any external system should return
`true` unconditionally, matching the behaviour of the default (manual)
distributor. A distributor that checks for an existing delivery should return
`false` when `overwrite` is `false` and a prior delivery is detected.

> The default distributor is the manual distributor. It returns `true`
> unconditionally: every workbook is considered delivered locally.

---

## `Submitter`

```typescript
type Submitter = (submitted: Submitter.Payload) => Promise<string | null>;

namespace Submitter {
  type Payload = {
    file: string;
    identifier: Identifier.Assigned;
    name: string;
    notebook: Notebook;
    path: string;
    submission: number | null;
  };
}
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

## `Collector`

```typescript
type Collector = (certified: Collector.Payload) => Promise<string | null>;

namespace Collector {
  type Score = {
    code: string;
    comment: string;
    points: number;
    possible: number;
    status: string;
  };

  type Payload = {
    certification: number | null;
    file: string;
    identifier: Identifier.Assigned;
    name: string;
    notebook: Notebook;
    path: string;
    points: number;
    possible: number;
    score: Score;
  };
}
```

Called after a workbook has been graded and certified. Returns an opaque
receipt that Correxit stores in workbook metadata, or `null` if the grade was
not recorded.

Verified grades carry in-memory provenance from authenticated rubric and issued
contents checks. The normal collection command authenticates before calling the
collector; a parsed report or certification timestamp is not a grade authority.
Plugins should consume these command results rather than constructing verified
grades from notebook metadata. The source-integrity contract requires format 2;
see [SECURITY](security.md) for the serialization and authentication contract.

The default implementation returns a content-addressed digest receipt. A
server-backed collector would POST the grade to the gradebook, correlate the
workbook via the identifier, and return the server's receipt.

---

## `Unlocker`

The `Unlocker` token provides key custody without requiring external plugins
to implement Correxit's internal cryptography or authentication loops.

```typescript
type Secret =
  | { key: string; passphrase: null }
  | { key: null; passphrase: string };

type Unlocker = {
  request(request: Unlocker.Request): AsyncIterable<Secret | null>;
  store(rubric: string, key: string): Promise<void>;
};

namespace Unlocker {
  type Purpose = 'create' | 'submit' | 'revise' | 'recover' | 'unlock';

  type Request = {
    identifier: Identifier | null;
    path: string;
    purpose: Purpose;
    silent: boolean;
  };
}
```

### Division of Responsibility

- **Key Custody (Plugin)**: The `Unlocker` plugin yields candidate secrets
  (`key` or `passphrase`) via `request()`, and persists author keys via `store()`.
  It does not perform cryptographic decryption or authenticate workbooks.
- **Authentication & Decryption (Correxit Core)**: Correxit tests candidate
  secrets against the workbook's rubric, derives keys using `security.derive(credentials, rubric.id)`,
  persists successful keys via `unlocker.store()`, unseals encrypted cells, and
  manages the in-memory key lifecycle.

### Request Lifecycle and Purposes

`request` receives the operation `purpose`, the notebook `path`, whether the
request is `silent`, and the `identifier` (if a rubric already exists):

| Purpose   | Description                                         |
| --------- | --------------------------------------------------- |
| `create`  | Convert a notebook into a workbook assignment.      |
| `unlock`  | Unlock an authored workbook for editing or grading. |
| `submit`  | Protect the student's submission keypair.           |
| `revise`  | Reopen student answers while keeping rubric locked. |
| `recover` | Forensic recovery of cell sources without rubric.   |

`request` is an `AsyncIterable`:

- For `unlock`, the plugin yields candidate secrets. Correxit tests each until
  one authenticates. Other purposes consume the first yielded choice. Persist
  any required student credential before yielding it, since the generator is
  closed once a choice is accepted.
- Yielding `null` proceeds without a secret (for fire-and-forget submission or
  skipping decryption).
- Ending the generator without a usable secret cancels the operation cleanly.
- Throwing an error stops the operation and displays the failure reason without
  falling back to interactive prompts.

### Eliminating Passphrase Dialogs (Hosted Services)

A hosted provider (e.g. `notebook.link`) can supply keys directly from an
authenticated API without showing any user prompts:

```typescript
import { JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Secret, Unlocker } from '@correxit/contracts';

const hostedUnlocker: JupyterFrontEndPlugin<Unlocker> = {
  id: 'notebook-link:unlocker',
  provides: Unlocker,
  autoStart: true,
  activate: () => {
    return {
      async *request({ identifier, purpose, silent }) {
        if (purpose === 'create') {
          const key = await api.generateAuthorKey();
          yield { key, passphrase: null };
          return;
        }

        if (purpose === 'unlock' && identifier) {
          const key = await api.getAuthorKey(identifier.rubric);
          if (key) yield { key, passphrase: null };
          return;
        }

        if ((purpose === 'submit' || purpose === 'revise') && identifier) {
          const key = await api.getStudentKey(
            identifier.rubric,
            identifier.assignee
          );
          if (key) yield { key, passphrase: null };
          return;
        }
      },

      async store(rubric: string, key: string) {
        await api.saveAuthorKey(rubric, key);
      }
    };
  }
};
```

---

## Providing a Plugin

Each token is a standard Lumino `Token<T>`. Declare a `JupyterFrontEndPlugin`
that `provides` the token:

```typescript
import { JupyterFrontEndPlugin } from '@jupyterlab/application';
import { Submitter } from '@correxit/contracts';

const submitter: JupyterFrontEndPlugin<Submitter> = {
  id: 'my-lms:submitter',
  provides: Submitter,
  autoStart: true,
  activate:
    () =>
    async ({ file, identifier, notebook }) => {
      const receipt = await myLms.submit({
        assignment: identifier.assignment,
        assignee: identifier.assignee,
        notebook
      });
      return receipt ?? null;
    }
};
export default submitter;
```

---

## Migration Guide: v2 to v3

If you authored plugins against Correxit v2:

1. **Depend on `@correxit/contracts` instead of `correxit`**:
   Update `package.json` dependencies to `"@correxit/contracts": "^1.0.0"`.
   In `jupyterlab.sharedPackages`, mark `"@correxit/contracts": { "singleton": true }`.
2. **Plain-data signatures**:
   - `Collector` receives `Collector.Payload` (`{ certification, file, identifier, name, notebook, path, points, possible, score }`).
   - `Submitter` receives `Submitter.Payload` (`{ file, identifier, name, notebook, path, submission }`).
   - `Distributor` receives `Distributor.Payload` (`{ identifier, notebook, overwrite, path, resources }`).
   - `Registrar` takes `identifier: Identifier` and returns `Registration[] | Registration.Group[] | null`.
3. **`Unlocker` refactor**:
   - Remove `unlock()` implementation. Correxit core now owns rubric unlocking.
   - Change `request()` from returning a single promise to an `AsyncIterable<Secret | null>` (e.g. `async function* request(...)`).
   - Implement `store(rubric: string, key: string): Promise<void>`.

---

## Corrector Run Commands

`correxit-corrector:run` returns a cold `AsyncGenerator<Corrector.Event>`.
Pass a unique string `run`, a directory `path`, `mode` (`scan`, `grade`, or
`collect`), and the boolean `overwrite` and `submitted` options. Discovery,
workbook reads, processing starts, results, safe diagnostic codes, and completion
are separate events. Returned workbook contexts belong to the run.

Result events carry `completed: true` when grading or collection completes,
including reuse of an authenticated grade. `completed: false` means collection
was skipped. This flag does not claim a change to the saved notebook.

Failure events carry safe codes: `directory`, `read`, `authenticate`, `invalid`,
`grade`, or `sync`. Authentication and invalid-workbook failures are not retried.
Other grading failures use the configured retry count. Collection is serial and
never retried automatically, since a failed delivery may already have reached
the collector.

`correxit-corrector:stop` accepts the run identity as `run`. It prevents new jobs
and retries, awaits active work, and retains completed results. Pass
`release: true` when the consumer no longer needs the contexts; they are disposed
only after active operations settle. Consumers must keep pulling the stream
while stopping, or close its iterator to trigger cleanup. Release each run when
finished with its results. Run identities and cancellation state stay in memory.

The existing `scan`, `batch`, and `collect` commands retain their arguments and
result shapes. Their returned contexts remain the caller's responsibility.

---

## Moodle Integration

Correxit includes built-in Moodle plugins for the **registrar** (assignment
metadata and rosters), **distributor** (delivery to students via Moodle
feedback attachments), and **collector** (posting certified grades back to
Moodle with the graded notebook attached). All three use the Moodle REST API
and need one-time administrator setup.

For the operational teacher and student workflow, including the browser-only
constraints that shape it, see [MOODLE](moodle.md).

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
