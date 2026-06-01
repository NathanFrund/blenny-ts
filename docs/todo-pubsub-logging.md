# Sweep: Replace threaded BlennyLogger with pub-sub log events

## Goal

Remove `BlennyLogger` as a threaded dependency through components (`auth.ts`,
`database.ts`, `db-guard.ts`, `rate-limiter.ts`, `app-state.ts`). Instead,
components publish log events to the event bus, and `createLogger` subscribes.

## Motivation

- No threading logger through constructors and configs
- Any component can log without new imports or interface changes
- Centralized control (could add DB sink, mute certain levels, etc.) without
  changing callers
- Consistent with existing event-driven patterns (`platform:ready`)

## Design

### 1. `src/types.ts` — Add log topic to BlennyEvents

```ts
export interface BlennyEvents {
  "platform:ready": { timestamp: number };
  "log": {
    level: "debug" | "info" | "warn" | "error";
    template: string;
    args?: Record<string, unknown>;
  };
}
```

### 2. `src/core/logger.ts` — Subscribe in createLogger

After `configure()` succeeds, subscribe to `"log"` events:

```ts
const blennyLogger = getLogger(["blenny"]);
subscribe("log", ({ level, template, args }) => {
  (blennyLogger[level] as (msg: string, ...args: unknown[]) => void)(
    template,
    args ?? {},
  );
});
```

Return a logger that publishes to the bus for backward compat, or remove the
`BlennyLogger` interface entirely and only use the bus. (Decision needed.)

### 3. `src/core/rate-limiter.ts` — First adopter

```ts
import { publish } from "./hub.ts";
// within the 429 branch:
publish("log", {
  level: "warn",
  template: "Rate limit exceeded for {client}",
  args: { client: ip },
});
```

No logger param needed in `createRateLimiter`.

### 4. Migration — Files to update

Each component that currently threads `BlennyLogger` gets migrated to
`publish("log", ...)`:

| File                       | Current                                                            | Migration                                                                                       |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `src/core/auth.ts`         | `AuthConfig.logger?: BlennyLogger`                                 | Remove field; replace `logger.debug(...)` with `publish("log", { level: "debug", ... })`        |
| `src/core/database.ts`     | `connectDatabase(config, logger?)`                                 | Remove logger param; replace `logger.info(...)` / `logger.warn(...)` with `publish("log", ...)` |
| `src/core/db-guard.ts`     | `withDb(fn, fallback, logger?)`                                    | Remove logger param; publish on unexpected error                                                |
| `src/core/rate-limiter.ts` | No logger yet                                                      | Add `publish("log", ...)` on 429                                                                |
| `src/core/app-state.ts`    | `logger: BlennyLogger`                                             | Remove field entirely                                                                           |
| `main.ts`                  | `const logger = await createLogger(config); state.logger = logger` | Remove state.logger assignment; keep logger for requestLogger (which may stay threaded)         |

### 5. `requestLogger` — Keep threaded or migrate?

`requestLogger` needs per-request structured logging (method, path, status,
duration). Two options:

- **Keep threaded**: `app.use(requestLogger(logger))` — simple, local to
  main.ts, not a component
- **Migrate**: Each middleware call creates args and publishes to bus. Works but
  slightly more verbose.

Recommendation: keep threaded. It's one call site in `main.ts`, not threaded
through components.

### 6. `NULL_LOGGER` — Keep for tests

The `NULL_LOGGER` pattern is useful in tests that need a `BlennyLogger` but
don't want output. Keep it after migration for backward compat during the
transition.

## Migration order (safe, incremental)

1. Add `"log"` to `BlennyEvents` in `types.ts`
2. Wire `subscribe("log", ...)` in `createLogger` (after `configure`)
3. One-by-one, migrate each file from `logger.log(...)` to
   `publish("log", ...)`:
   - `rate-limiter.ts` (new addition)
   - `auth.ts` (optional logger)
   - `database.ts` (optional logger)
   - `db-guard.ts` (optional logger)
4. Remove `logger` field from `AppState`
5. Clean up `main.ts` wiring
6. Remove `BlennyLogger` type if no longer needed anywhere

## Risks

- **Startup ordering**: `subscribe("log")` must happen before any component
  publishes. Already fine — `createLogger` runs before any component's
  `initialize`.
- **Sync subscribers**: If subscriber throws, publisher propagates. Subscriber
  must have internal try/catch (it already does — LogTape handles errors
  gracefully).
- **Type safety**: `args` is `Record<string, unknown>` through the bus. Callers
  should coerce/validate if reading from args.
