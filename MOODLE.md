# Correxit with Moodle

This guide describes the Moodle workflow that Correxit supports today.
It is intentionally narrow. Correxit is a browser-only Jupyter extension.
There is no backend, no server-side agent, and no trusted service running on
behalf of either the teacher or the student.

That constraint is not incidental. It defines the workflow.

## What this integration does

Correxit's built-in Moodle plugins support three things:

- registration: fetch assignment metadata and rosters from Moodle
- distribution: attach one assigned workbook per student via Moodle
- collection: post certified grades back to Moodle with the graded workbook

Correxit does not submit student work to Moodle on the student's behalf.
Students still upload their own notebooks through Moodle's normal assignment
submission flow.

That is the minimal workflow that a pure browser-side tool can support while
remaining honest about authority and credentials.

## What Moodle must provide

The Moodle side has four requirements.

1. An external service with the Correxit web service functions.
2. A teacher API token scoped to that service.
3. CORS configured so the Jupyter origin can call the Moodle REST API.
4. The assignment configured with **Feedback files** enabled.

Without feedback files, Correxit has nowhere to attach distributed or graded
workbooks.

The administrator setup, service functions, and token configuration live in
[PLUGINS](PLUGINS.md).

## The workflow

### 1. The teacher configures Moodle access

The teacher enters the Moodle URL and teacher token in the Correxit settings
for the Moodle registrar, distributor, and collector.

Correxit then talks directly to Moodle from the browser. The token never turns
Correxit into a backend. It is simply the teacher's own credential presented
from their own Jupyter session.

### 2. The teacher authors a workbook

The teacher creates or converts a notebook into a Correxit workbook, defines
the rubric, tests it, and locks it for distribution.

This part is LMS-agnostic and is described in [AUTHORING](AUTHORING.md).

### 3. The teacher registers the Moodle assignment

With the Moodle registrar enabled, Correxit fetches the teacher's visible
assignments and enrolled students. The teacher chooses the assignment, and the
workbook receives the assignment name, Moodle identifier, and roster.

At this point Correxit knows enough to issue one workbook per student.

### 4. The teacher distributes assigned workbooks

When the teacher distributes the workbook, Correxit always creates local copies.
With the Moodle distributor enabled, it also attaches each student's assigned
workbook to that student's Moodle assignment feedback files.

Each distributed workbook is personalized. Correxit locks the rubric,
encrypts secret references, encrypts the roster, strips the authoring key, and
binds the workbook to one assignee.

### 5. The student downloads the workbook and works locally

The student downloads their assigned workbook from Moodle. They may also
download any support files that the instructor attached to the Moodle
assignment itself.

The student can then open the workbook in any Jupyter they like: one provided
by the school, one provided by the instructor, or one they run themselves.

Correxit is not required for this step. The workbook is still a notebook.

### 6. The student submits through Moodle

After finishing the work, the student uploads the notebook back to Moodle
through the normal assignment submission interface.

If the student also has Correxit, they may use its submission features before
uploading. In particular, they may sign and seal the workbook. If they do not
have Correxit, they can still save the notebook in cleartext and upload it.

Correxit accepts both cases. The pure Moodle path does not depend on student
adoption of the extension.

### 7. The teacher downloads submissions

When ready, the teacher uses Moodle to download the submitted notebooks
locally.

This is the decisive boundary in the current design: Correxit grades local
workbooks inside Jupyter. It does not scan Moodle remotely for student
submissions, because there is no backend and no safe teacher-token story for
impersonating the student submission flow.

### 8. The teacher grades in Jupyter with Correxit

The teacher opens the downloaded submissions in Jupyter and uses Correxit's
Corrector and Reviewer to scan, batch-grade, review, certify, and inspect the
workbooks.

This is again local-first. The source of truth during grading is the notebook
file in front of the teacher.

### 9. The teacher collects grades back to Moodle

Once a workbook is certified, the Moodle collector can post the scaled numeric
grade back to Moodle and attach the graded notebook to the student's feedback
files.

The result is a closed loop:

- Moodle provides roster and assignment metadata.
- Correxit authors and personalizes the workbook.
- Moodle mediates student download and upload.
- Correxit grades locally.
- Moodle receives the final grade and graded notebook.

## Why this workflow is correct

It matches the authority model.

- The teacher token is used only for teacher actions.
- Students keep control of their own submissions.
- The notebook remains the durable artifact throughout.
- No secret keys or grading state require a server.

This is less ambitious than a full LMS-backed platform. It is also more honest.
The workflow says exactly what the architecture can guarantee.

## Where this guide fits

- [AUTHORING](AUTHORING.md) explains how to build the workbook itself.
- [PLUGINS](PLUGINS.md) explains the plugin contracts and Moodle setup.
- [SECURITY](SECURITY.md) explains locking, sealing, and integrity.

This document is the operational story that sits between them.
