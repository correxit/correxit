# Correxit AI Instructions

## Architecture & "Big Picture"

Correxit is a **serverless** JupyterLab extension for grading. All logic happens in the frontend.

- **Frontend-First**: The core logic resides in `src/` (TypeScript). The Python package (`correxit/`) is primarily for packaging and distribution.
- **Data Model**:
  - **Rubric**: The core data structure stored in notebook metadata (`rubric.ts`). It is **immutable** and versioned by `accessed` timestamps.
  - **Workbook**: A stateful abstraction for Jupyter notebooks that have an associated rubric. `Headless` workbooks only have document context whereas `Headed` workbooks also have a live Notebook widget.
  - **State**: A `Rubric` is either `Locked` (encrypted secret, for distribution) or `Unlocked` (decrypted secret, for editing).
- **Controller**: Use the **Command Pattern**. All user actions go through `src/correxit/commands.ts` or `src/corrector/commands.ts`. Avoid direct state mutation from UI components.

## Critical Workflows

- **Environment**: Check if user uses a relevant mamba/conda env (e.g. `mamba activate correxit`) or ask if it is ambiguous.
- **Package Manager**: Use `jlpm` (JupyterLab's pinned yarn) for all node scripts.
- **Build & Watch**:
  - **One-time build**: `jlpm build`
  - **Development**: Run `jlpm watch` in one terminal and `jupyter lab` in another.
- **Testing**:
  - Unit tests: `jlpm test` (Jest). maintain high coverage for core logic (`rubric.ts`, `security.ts`).
  - UI tests: `ui-tests/` directory (Playwright).

## Architecture Layers

1.  **Model**:
    - `src/correxit/rubric.ts`: Pure functions, immutable data structures.
    - `src/correxit/workbook.ts`: Functional interface for the stateful Jupyter notebook model. Handles side effects (metadata updates, content mutation).
2.  **Controller (`src/correxit/commands.ts`)**:
    - Registers commands in `CommandIDs`.
    - Orchestrates side effects (I/O, Model updates).
3.  **View (`src/ui/`)**:
    - React components.
    - Declarative, driven by props/state.
    - Avoids internal business logic.
4.  **Distribution (`src/correxit/propagator.ts`)**:
    - Handles the "Propagator Pattern" for distributing assignments to students without a backend server.
    - This is an extension point for connecting to other systems that may or may not have a backend server.

## Coding Conventions

- **Immutability**: When modifying rules/rubrics, always return a new object. See `Rubric` namespace.
- **Namespaces over Classes**: Eschew classes in favor of namespaces and functions whenever it is sensible (except for React Components and Jupyter Widgets).
- **Module Imports**: Always import internal utility modules (e.g. `description`, `input`, `io`, `kernels`, `propagator`, `security`, `state`) as namespaces (e.g., `import * as security from './security'`).
- **Security**:
  - Use `openpgp` for encryption.
  - Use `window.crypto` (via `crypto.subtle`) for signing/hashing.
  - **No Backend**: Never implement server-side handlers for grading logic. Everything stays in the `.ipynb` file metadata.
  - Isolate all cryptographic functions in one module (security.ts)

## Code Style Preferences

- **Idiomatic English**: Require single English words for all voluntary named tokens (e.g. use `stop` not `stopIndex`). Avoid compound words.
- **Const Grouping**: `const` declarations must be contiguous. A block of declarations must be preceded by a blank line or the top of a scope.
- **Helper Functions**: Extract small, scoped helper functions (e.g. `scan`, `position`) to enable single-word naming and avoid complex inline logic.
- **Functional Style**:
  - Avoid loops in favor of array methods (`map`, `filter`, `reduce`) whenever possible.
  - Exceptions: Async iterators (e.g. `propagator.ts`, `use-command.ts`) require `for await...of`.
  - Avoid `if` statements except for early returns.
  - Avoid negative sets (`!`) when positive checks are possible.
  - Avoid extraneous variables; prefer direct returns.
- **Beauty**: Bias toward beauty and readability, textbook quality code.

## Common Pitfalls

- **Async Operations**: Grading and propagation are async. Ensure UI provides feedback via the command pattern or `useCommand` hook.
- **Metadata Integrity**: Grading data is stored in the notebook (.ipynb file) metadata, under the key `correxit`. Ensure updates to metadata are atomic/transactional where possible via `Workbook.update`.
