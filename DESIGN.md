# Correxit design principles

## Security is the first step

Correxit workbooks are Jupyter notebooks, `.ipynb` files. They can be shared. This means that the integrity of the file is paramount. Correxit only writes
locked rubric contents to the notebook metadata.

The author _can_ save a workbook that is unlocked at the time of the save. This
means that reference cells will remain decrypted and readable. It is up to the
author to lock a workbook before distributing it, as with any other document to
be shared with others.

## `Workbook` is Jupyter notebook + `Rubric`

A `Rubric` is notebook metadata (`getMetadata('correxit')`) that contains the
encrypted solutions to the workbook, the assignee (if any), and other metadata.

`0` All rubric operations are functions in the `Rubric` namespace, e.g.,

- `Rubric.lock()`
- `Rubric.score()`, etc.

`1` All workbook operations are functions in the `Workbook` namespace, e.g.,

- `Workbook.open()`
- `Workbook.correct()`, etc.

`2` More complex operations that require multiple steps are commands in the Jupyter command system, e.g.

- `correxit-corrector:scan`
- `correxit-corrector:batch`

## User interfaces are thin clients

All of the logic executed by Correxit user interfaces (e.g., Correxit Corrector,
notebook/cell toolbar buttons, etc.) is implemented in the Jupyter command
system (i.e., `2` above).

## `function` `>` `class`

Except in places where the Jupyter APIs require it (e.g., small `ReactWidget`
wrappers for Correxit UI components), Correxit is built with functions. There is
very little state except what is resident in memory for a UI to render and a
private cache for rubrics to prevent constant re-parsing of notebook metadata.

React is helpful here because the design of functional components along with
hooks (cf. `useCommand()` for commands) fits the function-based API of Correxit.

## Prefer single-word nouns, verbs, and adjectives

This is subjective and not always practical, especially in cases where
destructuring or using spread operators. But when it _is_ possible and practical
a single word identifier is better than a compound identifier.

One prominent counterexample is `set*` and `use*` React state managment
functions, which are both well-established conventions and are enforced by some
React tooling. So, e.g., the hook mentioned above is named `useCommand`.
