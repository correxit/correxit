# Technical debt

This ledger records the auditability work deferred from the current readability
review. The item numbers preserve that review so discussion can move between
the pull request and this document without translation.

## 2. Command streams

`useCommand` compresses execution, buffering, throttling, interruption, and
React lifecycle into one effect. Its serialized argument identity is
intentional, but currently requires a local hook-lint exception.

- [ ] Name the stream states and transitions.
- [ ] Separate consumption, buffering, and React cleanup.
- [ ] Test completion, rejection, interruption, restart, and a pending
      throttled flush.
- [ ] Remove the `react-hooks/exhaustive-deps` exception.

Scope: `src/correxit/use-command.ts`.

## 3. Type boundaries

The `Credentials.normalize` and command `reify` boundaries construct
discriminated unions with assertions. The unions describe the resulting states
well, but the constructors do not make their proof visible to an auditor.

- [ ] Replace the assertions with branches that construct one legal variant at
      a time.
- [ ] Keep impossible combinations unrepresentable.
- [ ] Add table-driven tests for every accepted and rejected input shape.

Scope: `src/correxit/workbook.ts`, `src/correxit/commands.ts`, and
`src/corrector/commands.ts`.

## 4. Command registry

The core command registry is a large composition root, and local aliases
sometimes hide whether work belongs to `Workbook`, `Rubric`, a plugin, or the
controller.

- [ ] Group registrations by lifecycle capability without changing command
      identifiers or ordering.
- [ ] Preserve model namespace qualifiers at mutation boundaries.
- [ ] Extract only cohesive command families with explicit dependencies.
- [ ] Verify the result with the corresponding Playwright modules.

Scope: `src/correxit/commands.ts`.

## 8. Hidden module state

Several plugins and model helpers use immediately invoked closures to conceal
mutable state. The encapsulation is sound, but the repeated shape makes
lifetime, ownership, and teardown harder to scan.

- [ ] Replace state-bearing closures with named module state or small factories
      where ownership becomes clearer.
- [ ] Keep state private and preserve every activation/deactivation boundary.
- [ ] Apply one consistent form to plugin teardown, workbook caching, and the
      monitor stream.

Scope: `src/plugins.tsx`, `src/correxit/commands.ts`,
`src/correxit/workbook.ts`, and monitor implementations.
