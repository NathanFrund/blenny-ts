# Plan: make SurrealDB connect fail fast instead of hanging

Status: **proposed** (not implemented)

## Problem

When `database.type` is `surreal` (the default) and no SurrealDB is reachable,
the process hangs at boot instead of failing. `setupDatabase()` never returns,
so `Bun.serve()` is never reached.

This is **not** a Bun regression. Verified with the same SDK version
(`surrealdb@2.0.3`) against a refused endpoint (`ws://127.0.0.1:1/rpc`):

| Runtime     | Result      | `client.status` |
| ----------- | ----------- | --------------- |
| Deno 2.8.3  | `HUNG >25s` | `reconnecting`  |
| Bun 1.4.3   | `HUNG >8s`  | `reconnecting`  |

The original Deno build hung the same way.

## Root cause (SDK, runtime-independent)

In `@surrealdb/surrealdb` (2.0.3):

- `WebSocketEngine.createSocket()` resolves only on the socket `close` event and
  has **no timeout**.
- On failure the engine publishes `"error"` then `"disconnected"` /
  `"reconnecting"` on its **own** publisher.
- `ConnectionController` subscribes to the engine's `"connected"`,
  `"disconnected"`, and `"reconnecting"` events — but **not** `"error"`.
  Its `#onDisconnected()` emits `"disconnected"`, never `"error"`.
- `ConnectionController.connect()` awaits `ready()`, which does
  `subscribeFirst("connected", "error")`. Since neither ever arrives,
  `connect()` never resolves or rejects.
- Default reconnect is `enabled: true, attempts: 5` (backoff ~2s/4s/8s/16s/32s);
  even after exhaustion the error is published only on the engine publisher,
  which the controller ignores — so it still never rejects.

`src/core/db-manager.ts` calls `this.client.connect(...)` inside a 3-attempt
retry loop, so it blocks forever on the first attempt.

## Goal

Bound the connect attempt so boot fails fast with a clear error (or proceeds),
instead of hanging. SurrealDB running normally must be unaffected.

## Decisions

- `surreal.connect_timeout_ms` default: **5000**.
- `main.ts` prints a clean error and `process.exit(1)` on boot failure.
- No `database.type: "none"` / DB-less mode in this change (separate track).
- Include a real-socket fail-fast integration test.
- Make retries configurable so the integration test can run fast and worst-case
  boot delay stays bounded.

## Changes

### 1. `src/core/config.ts`

- Add defaults:
  - `"surreal.connect_timeout_ms": "5000"`
  - `"surreal.connect_retries": "3"`
- Add getters (mirroring `idleTimeoutMs`):
  - `surrealConnectTimeoutMs()` -> `getNumeric("surreal.connect_timeout_ms", 100, 600_000)`
  - `surrealConnectRetries()` -> `getNumeric("surreal.connect_retries", 1, 10)`
- Env (`BLENNY_SURREAL_CONNECT_TIMEOUT_MS`, `BLENNY_SURREAL_CONNECT_RETRIES`) and
  CLI (`--surreal.connect_timeout_ms=`, `--surreal.connect_retries=`) auto-wire
  because the keys are in `DEFAULTS` / contain `.`.

### 2. New `src/core/async.ts`

```ts
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T>;
```

- `Promise.race` against a `setTimeout` that rejects with `new Error(message)`.
- `clearTimeout` in `finally` so no dangling timer keeps the event loop alive.

### 3. `src/core/db-manager.ts`

- Replace the `MAX_CONNECT_RETRIES` const with `this.config.surrealConnectRetries()`.
- Per attempt:

  ```ts
  await withTimeout(
    this.client.connect(this.config.surrealUrl, {
      authentication: {
        username: this.config.surrealUser,
        password: this.config.surrealPass,
      },
      reconnect: { enabled: false }, // our loop owns retries; stop SDK timers
    }),
    this.config.surrealConnectTimeoutMs(),
    `SurrealDB connect timed out after ${timeoutMs}ms (${this.config.surrealUrl})`,
  );
  ```

- Existing `catch` already records `lastErr`, closes the client, and retries with
  backoff; after the final attempt `connect()` throws.
- On throw: `connectDatabase()` catches, logs
  `[database] Failed to connect to "surreal"`, returns `null` ->
  `state.db = undefined` -> `form-auth-surreal` `requireDb()` throws a clear
  `DbError`.

### 4. `main.ts` — clean fail-fast

- Wrap the boot section (`setupDatabase` -> `registerPlatformEndpoints`) in
  `try/catch`. On error: `publish("log", { level: "error", ... })`,
  `console.error(...)`, then `process.exit(1)`.

### 5. Tests

- `tests/async_test.ts` (new): resolves fast; rejects with the message on
  timeout; clears its timer.
- `tests/config_test.ts`: default `5000` / `3`; override; out-of-range throws.
- `tests/db-manager_test.ts` (new): `SurrealConnectionManager` against
  `ws://127.0.0.1:1/rpc` with `connect_timeout_ms: 300`,
  `connect_retries: 1` -> rejects quickly instead of hanging.

### 6. Docs

- `docs/database.md`: document the two new keys + fail-fast behavior.
- `MIGRATION_BUN.md` "Post-port fixes": record this as a deliberate deviation
  (original Deno build hung; Bun build times out and fails fast).

## Behavior after

- **No SurrealDB:** boot aborts within seconds with
  `[database] Failed to connect to "surreal"` + a timeout error, then
  `DbError: Database is not connected (form-auth-surreal)`, exit 1.
- **SurrealDB running:** unchanged normal boot.

## Verification

1. `bun run check`
2. `bun test` (expect +~8 tests, still 0 fail)
3. Manual:
   - `bun main.ts` with no DB -> fast, clear failure, exit 1.
   - `bun main.ts` with SurrealDB up -> normal serve.

## Notes / non-goals

- The SDK's abandoned `connect()` promise per attempt leaves a
  `subscribeFirst` listener registered (minor, bounded by retry count).
- Running without any DB (a `database.type: "none"` driver, or switching the
  active auth module to `.form-auth-kv`) is intentionally out of scope here.
