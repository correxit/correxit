# Correxit AI Developer Instructions

You are an expert developer working on **Correxit**, a serverless, frontend-only JupyterLab extension. Your goal is to write code that adheres strictly to the project's architectural invariants and functional style.

## 1. Core Architecture

- **No Backend**: Logic exists solely in the browser. Correxit is purely client-side.
- **Two Modules**: `correxit/` (assignment authoring and distribution) and `corrector/` (grading and batch processing). Shared primitives (`Rubric`, `Workbook`, `Security`) live at the package root.
- **MVC Pattern**:
  - **Model**: `rubric.ts` (immutable data), `workbook.ts` (notebook state).
  - **Controller**: `commands.ts` (orchestrates all mutations).
  - **View**: `ui/` (React components).
- **Command-Driven**: **Never** mutate state directly from UI components. UI triggers Commands; Commands call Model functions.
- **Plugin Composition**: Each plugin provides exactly one capability via a JupyterLab token (`Consumer`, `Collector`, `Submitter`, `Unlocker`, `Registrar`, `Monitor`). Core logic is decoupled from IO. Swapping a file-system consumer for an LMS consumer requires no changes to `propagator.ts`.

## 2. Critical Technical Invariants

### Security Model

- **Explicit Nulls**: Use `field: Type | null` instead of optional `field?: Type`.
  - _Reason_: Stable JSON serialization is required for cryptographic signatures.
- **Validate-Before-Encrypt**: Always validate rubric/assignment data _before_ encryption.
  - _Wrong_: Encrypt -> Validate.
  - _Right_: Validate -> Encrypt.
- **Keys Never on Disk**: Cryptographic keys only exist in memory (closure scope, `Set<string>`). They enter via user input and die with the browser tab. Never serialize keys to notebook metadata or persist them.
- **Immutability**: `Rubric` is an immutable data structure. Mutations return new instances (e.g., `Rubric.add()`).

### State Management

- **Workbook Abstraction**: Use `Workbook` functions (e.g., `Workbook.update`) to modify notebook metadata. Do not touch `notebook.model.metadata` directly.
- **WeakMap Caching**: `Workbook.open()` uses a WeakMap cache to avoid expensive decryption/parsing.

### Type System Patterns

- **Discriminated Unions**: Use union types with a common discriminator field to encode mutually exclusive states.
  - _Example_: `Reified` type in `commands.ts` enables safe type narrowing after `if (!rubric)` guards.
  - _Pattern_: After checking `if (!rubric) return`, TypeScript knows `workbook` is non-null.
- **Workbook Identity**: Use `Workbook.identifier()` to get canonical identifier with assignee, assignment ID, and signature.
- **Timestamps**: Use `Workbook.timestamp()` to retrieve the assignment report timestamp (throws if missing).

## 3. Asynchronous Patterns

- **Pull-Based Generators**: Long-running ops (propagation, grading, scanning) are cold `async function*` generators. They do no work until iterated. Backpressure is inherent. Each `yield` suspends until the consumer pulls.
- **Generator Pipelines**: Composition is via `yield*` delegation: `propagator yield* consumer`, `consumer yield* stream`. No push channels, no buffers, no callbacks.
- **UI Consumption**: Use the custom `useCommand` hook to consume these generators.
  - _Pattern_: `const [messages, idle] = useCommand(commands, 'command:id', args);`
  - This hook throttles updates ~60fps and handles cleanup.
- **Monitor**: The `Stream`-based `Monitor` plugin is the one hot (push) async iterable in the system. It emits workbook changes as the user switches tabs. The sidebar subscribes via `for await`.

## 4. Coding Style & Conventions

- **Functional over OOP**: Use `namespace` and pure functions. Avoid `class` except where required by Jupyter APIs.
- **Array Methods**: logic should be expression-oriented (`map`, `filter`, `find`) rather than statement-oriented loops.
- **Object Construction**:
  - **Preferred**: `Object.fromEntries(items.map(...))`
  - **Discouraged**: `items.reduce({...acc}, ...)` (Spread in reduce is a performance/complexity anti-pattern).
  - **Allowed**: `reduce` is fine for aggregation (sums, counts).
- **Naming**: Prefer single, distinct English words (e.g., `report` vs `scoreReport`). Names should be domain words (`propagate`, `certify`, `lease`) not pattern words (`producer`, `handler`, `manager`). Bias toward beauty.

## 5. Common Pitfalls (Quick Check)

| Antipattern                             | Correction                                   |
| --------------------------------------- | -------------------------------------------- |
| Mutating `rubric` object                | Return new `rubric` via `Rubric.*` functions |
| Accessing `notebook.model` in UI        | Execute a Command instead                    |
| `interface Config { key?: string }`     | `interface Config { key: string \mid null }` |
| `reduce((acc, x) => ({...acc, x}), {})` | `Object.fromEntries(arr.map(x => [k, v]))`   |

## 6. Testing Strategy

- **Unit Tests (`src/__tests__/`)**: For pure logic and isolated modules. The following have Jest unit tests:
  - `rubric.ts`, `state.ts`, `kernels.ts`, `unlocker.ts`, `grader.ts`
- **Playwright Tests (`ui-tests/`)**: For modules that require a live JupyterLab environment. These serve as the effective unit tests for the following — do not attempt to Jest-mock them:
  - `workbook.ts`, `commands.ts` (both `correxit/` and `corrector/`), `corrector.tsx`, `widget.tsx`

## 7. Key Module Map

- `rubric.ts`: Core immutable data model & scoring logic.
- `workbook.ts`: Stateful notebook wrapper & metadata I/O. Includes `certify()` for grading + locking + freezing.
- `security.ts`: `openpgp` & `window.crypto` wrappers.
- `commands.ts`: The central controller registry. Defines `Reified` type for safe workbook resolution.
- `propagator.ts`: Async generator for assignment distribution to rosters.
- `io.ts`: File system operations (create, mkdir, folder naming, workbook fetching).
- `correxit.ts`: Plugin type definitions (`Collector`, `Consumer`, `Registrar`, `Submitter`, `Unlocker`).
- `kernels.ts`: Kernel pool with lease/release/restart lifecycle and TTL eviction. Exports `configure({ concurrency, retries, timeout })`, `cap()`, `retries()`, and `timeout()` for settings-driven control.
- `grader.ts`: Bounded-concurrency async generator for batch grading. Accepts a `recover` callback, `cap`, and `timeout` (ms). Scanner accepts `Iterable | AsyncIterable`; failures are recovered and yielded so nothing stalls the pipeline.
- `state.ts`: In-memory cache for active workbook and cell scores (`Map` with FIFO eviction).
- `use-command.ts`: React hook bridging async generators to component state at ~60fps. Restarts the stream whenever `id` or serialized `args` changes; cleanup marks the prior stream interrupted.
