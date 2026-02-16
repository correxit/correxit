# Correxit AI Developer Instructions

You are an expert developer working on **Correxit**, a serverless, frontend-only JupyterLab extension. Your goal is to write code that adheres strictly to the project's architectural invariants and functional style.

## 1. Core Architecture

- **No Backend**: Logic exists solely in the browser. Correxit is purely client-side.
- **MVC Pattern**:
  - **Model**: `rubric.ts` (immutable data), `workbook.ts` (notebook state).
  - **Controller**: `commands.ts` (orchestrates all mutations).
  - **View**: `ui/` (React components).
- **Command-Driven**: **Never** mutate state directly from UI components. UI triggers Commands; Commands call Model functions.

## 2. Critical Technical Invariants

### Data Integrity & Security

- **Explicit Nulls**: Use `field: Type | null` instead of optional `field?: Type`.
  - _Reason_: Stable JSON serialization is required for cryptographic signatures.
- **Validate-Before-Encrypt**: Always validate rubric/assignment data _before_ encryption.
  - _Wrong_: Encrypt -> Validate.
  - _Right_: Validate -> Encrypt.
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

- **Streaming / Async Generators**: Long-running ops (grading, distributing) must implement the `async generator` pattern yielding updates.
- **UI Consumption**: Use the custom `useCommand` hook to consume these generators.
  - _Pattern_: `const [messages, idle] = useCommand(commands, 'command:id', args);`
  - This hook throttles updates ~60fps and handles cleanup.

## 4. Coding Style & Conventions

- **Functional over OOP**: Use `namespace` and pure functions. Avoid `class` except where required by Jupyter APIs.
- **Array Methods**: logic should be expression-oriented (`map`, `filter`, `find`) rather than statement-oriented loops.
- **Object Construction**:
  - **Preferred**: `Object.fromEntries(items.map(...))`
  - **Discouraged**: `items.reduce({...acc}, ...)` (Spread in reduce is a performance/complexity anti-pattern).
  - **Allowed**: `reduce` is fine for aggregation (sums, counts).
- **Naming**: Prefer single, distinct English words (e.g., `report` vs `scoreReport`).

## 5. Common Pitfalls (Quick Check)

| Antipattern                             | Correction                                   |
| --------------------------------------- | -------------------------------------------- |
| Mutating `rubric` object                | Return new `rubric` via `Rubric.*` functions |
| Accessing `notebook.model` in UI        | Execute a Command instead                    |
| `interface Config { key?: string }`     | `interface Config { key: string \mid null }` |
| `reduce((acc, x) => ({...acc, x}), {})` | `Object.fromEntries(arr.map(x => [k, v]))`   |

## 6. Key Module Map

- `rubric.ts`: Core immutable data model & scoring logic.
- `workbook.ts`: Stateful notebook wrapper & metadata I/O. Includes `certify()` for grading + locking + freezing.
- `security.ts`: `openpgp` & `window.crypto` wrappers.
- `commands.ts`: The central controller registry. Defines `Reified` type for safe workbook resolution.
- `propagator.ts`: Async generator for assignment distribution to rosters.
- `io.ts`: File system operations (create, mkdir, folder naming, workbook fetching).
- `correxit.ts`: Plugin type definitions (`Collector`, `Consumer`, `Registrar`, `Submitter`, `Unlocker`).
