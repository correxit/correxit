# Correxit design principles

This document is a guide for contributors and maintainers, detailing the
architectural decisions, core data flow, and key technical principles of
Correxit.

## Security is the first step

Correxit workbooks are Jupyter notebooks, `.ipynb` files, that have rubric data
encapsulated in the notebook metadata. They can, of course, be shared. This
means that the integrity of the file is paramount. Correxit only writes locked
rubric contents to the notebook metadata.

The author _can_ save a workbook that is unlocked at the time of the save. This
means that reference cells will remain decrypted and readable. The rubric will
remain locked and secure. It is up to the author to lock a workbook's content
before distributing it, as with any other document to be shared with others.

We use `openpgp.js` for all encryption/decryption operations and native
`window.crypto` for signing.

## Architectural overview

Correxit uses Jupyter/Lumino commands as the controller layer of its
architecture. All user interactions and long-running background tasks are
mediated by a small public-facing API of commands that control multiple UIs:

- the Correxit sidebar for the Jupyter notebook interface
- the Corrector UI for batch grading multiple workbooks
- cell and notebook toolbar buttons, etc.

The architecture is divided into three main layers:

| Layer                     | Responsibility                                                                                                                              | Modules                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **User Interface**        | Display state, accept user input, and execute commands. Purely declarative except for minimalist use of `ReactWidget`.                      | `src/ui/`, `src/corrector/`, `src/correxit/input.ts`, `src/correxit/use-command.ts` |
| **Commands**              | Defines all permissible actions and routes them to the business logic. Acts as an orchestrator of the Rubric/Workbook APIs.                 | `src/correxit/commands.ts`, `src/corrector/commands.ts`                             |
| **`Rubric` & `Workbook`** | Manages mutable state (`Workbook`), immutable operations (`Rubric`), cryptographic operations, file manipulation, and kernel communication. | `src/correxit/rubric.ts`, `src/correxit/workbook.ts`, et al.                        |

**Principle:** _All logic that modifies state or initiates an action should be
executed via a command._ The UI should not directly call manipulation functions.

## Data model: an immutable `Rubric` (`rubric.ts`)

The central piece of application data is the `Rubric`, which is stored in the
notebook's metadata under the key `correxit`. A Correxit `Workbook` is a Jupyter
notebook that has a `Rubric`, which describes how to grade and assign it.

A rubric is immutable, so each change is a new rubric (with a new `accessed`
timestamp), and typically via one of the functions in the `rubric.ts` module.

A rubric is defined by two mutually exclusive states:

### The `Locked`/`Unlocked` state

The `Rubric` must always be one of two union types:

1. **`Rubric.Unlocked`**: The live, mutable working state. Contains the
   decryption `key` and the full cell configuration (`secret`). This state is used
   for editing and configuration.

2. **`Rubric.Locked`**: The persisted, encrypted state stored in the notebook
   metadata. The `key` field is `null`, and the sensitive configuration (`secret`)
   is an encrypted string. This state is used for distribution and secure
   correction.

## Data model: `Workbook` (`workbook.ts`)

`Workbook` is an abstraction that maps onto active `Headed` instances of
`NotebookPanel` as well as `Headless` workbooks that only have a `context` and
`content: null`.

### Rubric state cache

To avoid repeated decryption and normalization (which is costly), the
`workbook.ts` module uses a **`WeakMap`** to cache the current `Rubric`
instance.

### Active workbook state

All command arguments must be serializable, so command logic
(e.g., `isEnabled`, `isVisible`) that needs to resolve a workbook or a cell
synchronously can access `state.workbook()` and `state.cell()` to resolve or
return `null`.

Command `execute` functions are `async` so they can use `reify()` to resolve a
workbook by checking `state.workbook()` and/or fetching when appropriate.

**Maintainer Note:** Use `Workbook.open()` (or local aliases) to
retrieve the current rubric.

## Asynchronous & streaming patterns

Long-running operations (like bulk grading or propagation) must provide
real-time feedback to the user, e.g., progress bars, logging output, pending
indicators, and progressive loading.

### The `useCommand` React hook (`use-command.ts`)

The `useCommand` hook is designed to consume the asynchronous iterable output of
a command.

- It manages the full asynchronous lifecycle: resets state, sets `idle=false`
  iterates over the stream (`for await...`), and handles component unmounting
  (via `interrupted` flag) for cleanup.

## Functional

Except in places where the Jupyter APIs require it (e.g., small `ReactWidget`
wrappers for Correxit UI components), Correxit is built with functions.

React is helpful here because the design of functional components along with
hooks (cf. `useCommand()` for commands) fits the function-based API of Correxit.

## Prefer single-word nouns, verbs, and adjectives

This is subjective and not always practical, especially in cases where
destructuring or using spread operators. But when it _is_ possible and practical
a single word identifier is better than a compound identifier.

One prominent counterexample is `set*` and `use*` React state managment
functions, which are both well-established conventions and are enforced by some
React tooling. So, e.g., the hook mentioned above is named `useCommand`.
