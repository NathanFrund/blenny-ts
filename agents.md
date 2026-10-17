# Blenny-ts — Agent Briefing

Bun/TypeScript port of the Blenny framework. Hypermedia-driven, real-time,
single-binary platform.

---

## Runtime & Tooling

- **Runtime:** [Bun](https://bun.sh). No Deno APIs anywhere.
- **Scripts** (`package.json`): `dev`, `start`, `test`, `check`, `generate-manifest`, `compile`, `init`.
- **Dependencies** are pinned in `package.json`. JSR packages come in through the
  npm registry mirror (`.npmrc` sets `@jsr:registry=https://npm.jsr.io`); e.g.
  `"@std/assert": "npm:@jsr/std__assert@1.0.19"`. Do **not** use native `jsr:`
  specifiers (Bun 1.4.3 fails to resolve them).
- `@hono/hono` is an npm alias for `hono`. JSX uses
  `"jsxImportSource": "@hono/hono/jsx"` (the alias path, not bare `hono/jsx`).
- Type-check with `bun run check` (`bun run generate-manifest && tsc --noEmit`
  — the manifest is generated/gitignored, so it must exist for `tsc` to resolve
  the dynamic `import("../modules/manifest.ts")`). `tsconfig.json` maps
  `@blenny/types`, `@blenny/core/*`, `@blenny/lib/*` to `src/`.
- OTel is **deferred** behind a loud no-op stub in `tracing.ts` (see
  [docs/telemetry.md](docs/telemetry.md)). Set `BLENNY_TELEMETRY_STRICT=1` to
  make every instrumentation call throw `TelemetryNotConfiguredError`.

---

## Key Idioms & Patterns

### Modules

- Drop `.ts`/`.tsx` into `src/modules/` or a directory with
  `index.ts`/`index.tsx`.
- Directory modules: `module-loader.ts` scans for `index.ts`/`index.tsx` inside.
- Dot-prefixed entries (`src/modules/auth/.form-auth-kv/`) are **skipped** by the
  loader — used for disabled/inactive modules that are importable by explicit path.
- Auto-discovered at boot by `module-loader.ts` (filesystem scan or manifest for
  compiled binaries).
- `const myModule: BlennyModule = { ... }; export default myModule;` — never
  `satisfies`.
- Lifecycle hooks: `initialize(state)`, `start()`, `stop()`.
- Capabilities: `capabilities: ["auth"]` for boot-time conflict detection.
- Routes: `{ method, path, handler, auth? }` — `auth: true` activates the auth
  guard, `auth: "role"` for a role check.

### AppState

- Single object injected into modules during `initialize(state)`.
- Contains: `hub`, `conduit`, `config`, and optional `auth` (set by the auth
  module), `store` (UserStore), `db` (SurrealDB).

### TransportHub

- Central connection manager. `registerConnection` / `unregisterConnection`.
- Two connection types: `SseConnection` (Datastar SDK) and `WsConnection` (raw
  HTML/JSON/script).
- Per-tab connections via `crypto.randomUUID()`. Cleanup on `AbortSignal`.
- `hub.write()` calls `conn.send()` synchronously before the first `await` — do
  not wrap delivery in a deferred microtask (tests assert `sent` synchronously).

### BlennyPublisher

- Static class for zero-ceremony real-time pushes: `broadcastHtml`,
  `directHtml`, `broadcastData`, `directData`.
- Initialized once at boot via `BlennyPublisher.init(hub)`. Testable via
  `BlennyPublisher.reset()`.

### Pub-Sub Logging

- Components publish via `publish("log", { level, template, args })`.
- `createLogger` subscribes to `"log"` events in one place and forwards to
  LogTape.
- `requestLogger()` middleware also uses the bus.

### Auth

- Two peer modules; only one can be active (both declare `capabilities: ["auth"]`):
  - **`form-auth-surreal/`** — SurrealDB-backed, argon2 via SurrealQL,
    bucket-based avatar storage (currently active).
  - **`.form-auth-kv/`** (dot-prefixed, disabled) — SQLite-backed
    (`openSqliteStore`) with `FsBlobStore` avatars; on your laptop this is a
    SQLite file, with no external database required.
- A module sets `state.auth` (an `AuthBundle`) during `initialize()`.
- `AuthBundle` provides `middleware` (global JWT reader), `requireUser`,
  `requireRole`.
- `main.ts` checks `state.auth` after initialization.
- Profile page at `/auth/profile` with avatar display and upload form.

### Conduit

- Datastar-aware JSX renderer. Returns a fragment on Datastar SSE merges, a full
  layout on page loads.
- Detection: `c.req.header("HX-Request") !== undefined` (HTMX) or Datastar
  signals.
- Per-response layout override: `conduit.respond(c, content, { layout })`.

### Config

- Composite provider: CLI args > env vars (`BLENNY_<KEY>`) > `blenny.json` >
  embedded defaults.
- Convenience getters: `config.port`, `config.jwtSecret`, `config.surrealUrl`,
  etc.
- Raw access: `config.at("any.dotted.key")`.

### Validation

- **`src/core/validation.ts`** — Valibot schemas: `SignalSchema`,
  `UsernameSchema`, `PasswordSchema`.
- `escapeHtml()` is defined inline in `validation.ts` (was `@std/html`).

### Database

- Optional SurrealDB connection. `state.db` is the Surreal client or `undefined`.
- `requireDb()` / `withDb()` in `db-guard.ts` for fail-fast or graceful fallback.
- `database.ts` connects at root level, creates NS/DB, then `use()` them.
- SurrealDB v3 SDK v2 — CBOR codec, returns `ArrayBuffer` for binary data (not
  `Uint8Array`).

### UserStore & BlobStore

- `UserStore` interface: `findById`, `findByUsername`, `findAll`, `createUser`,
  `setPassword`, `updateAvatarKey`, `updateRole`, `changePassword`, `deleteUser`.
- Implementations: `SurrealUserStore` (SurrealQL + argon2 server-side),
  `SqliteUserStore` (`bun:sqlite`), `InMemoryUserStore` (memory).
- `BlobStore` interface: `set`, `getAsResponse`, `remove`.
- Implementations: `FsBlobStore` (filesystem, default `./data/blobs`).
- `openSqliteStore(dbPath, blobStore)` returns `{ db, store, blobStore }`; the
  store creates the schema (`PRAGMA journal_mode=WAL`,
  `CREATE TABLE IF NOT EXISTS users`).

---

## Boot Order (`main.ts`)

1. Load config + check JWT secret
2. Create services (Hono app, hub, conduit, state, supervisor)
3. Set up the database (optional SurrealDB connection)
4. Configure middleware (CORS, CSRF, rate limiters, body limit)
5. Configure error handler + not-found handler
6. Discover modules (scan or `manifest.ts`)
7. Detect capability conflicts + missing dependencies
8. Initialize modules (calls `initialize()`), ordered by
   `requires`/`capabilities` (`sortByDependencies`)
9. Apply auth middleware globally
10. Register module routes
11. Subscribe module events
12. Start modules (calls `start()`)
13. Register platform endpoints (health, SSE, WS, static)
14. Start server (`Bun.serve()`); on SIGINT/SIGTERM drain and `stop()` modules

---

## Important Decisions & Rationale

| Decision                     | Why                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| **Auth via convention**      | A module sets `state.auth`. No framework trait.                                               |
| **SDK over custom encoder**  | Official `@starfederation/datastar-sdk` replaces all encoder code.                            |
| **Capabilities**             | Self-declaring enables boot-time conflict detection (e.g., dual auth).                        |
| **BlennyPublisher (static)** | Zero-ceremony broadcasting from any code.                                                     |
| **Dot-prefix disable**       | `module-loader.ts` skips entries starting with `.` — simple toggle.                           |
| **CBOR ArrayBuffer**         | SurrealDB SDK v2 CBOR decoder returns `ArrayBuffer` for byte strings, not `Uint8Array`.       |
| **SurrealDB argon2**         | Password hashing done server-side via `crypto::argon2::generate/compare`. No app-side crypto. |
| **Bucket ops try/catch**     | `DEFINE BUCKET` requires `--experimental-files`; gracefully degraded.                         |
| **Passive framework**        | No baked clock. All active logic lives in module `start()`/`stop()`.                          |

---

## Architectural Guardrails

### Module Lifecycles

- **No Manual Main Wiring** — modules self-assemble via filesystem discovery.
- **Lifecycle Hooks** — respect `initialize`, `start`, `stop`.

### Transport

- **SSE Always Active** — WebSocket is a sidecar, never a replacement.
- **Datastar SDK Only** — `@starfederation/datastar-sdk` is the sole SSE wire
  format.
- **Intent Routing** — Messages retain `ui`, `data`, `command`, `notification`
  filtering.
- **No HTMX** — Not used. Datastar for real-time, plain HTML forms for auth.

### Security

- **Auth by Convention** — always a module that sets `state.auth`.
- **Config via Composite Provider** — CLI > env > file > defaults.
- **CSRF Protection** — `csrf()` middleware blocks POST without `Origin` header.

---

## Current State (October 2026)

- Full framework: modules, hub, SSE, WS, conduit, config, auth (two peers),
  optional SurrealDB database, SQLite + filesystem storage.
- 76 tests across 29 files: 74 passing, 2 skipped (SurrealDB integration tests
  without `BLENNY_SURREAL_URL`).
- `bun run check` (`generate-manifest` + `tsc --noEmit`) clean.
- Compiled binaries: `manifest.ts` support for route registration without a
  filesystem scan.

---

## Code Style

- **Formatting:** 2-space indent, 120-char width (`bunfig.toml` `[fmt]`).
- **Type Checking:** `bun run check` — zero errors.
- **Zero `any`:** No `any` in source files (`src/`). Test files (`tests/`) may
  use `as any` sparingly.
- **Imports:** Always explicit file extensions (`.ts`, `.tsx`). Group: node/bun
  built-ins, external deps, internal modules.

---

## Testing

```bash
bun test
```

`bunfig.toml` preloads `tests/preload.ts`, which defines a global `step(name, fn)`
helper (typed in `tests/globals.d.ts`). Use it for nested steps — Bun forbids
nested `test()` calls.

### Key test files

| Test                             | What it covers                                        |
| -------------------------------- | ----------------------------------------------------- |
| `tests/form-auth_test.ts`        | Registration, sign-in, sign-out, auth guard           |
| `tests/surreal-store_test.ts`    | SurrealUserStore (gated behind `BLENNY_SURREAL_URL`)  |
| `tests/sqlite-user-store_test.ts`| SqliteUserStore (+ FsBlobStore)                       |
| `tests/fs-blob-store_test.ts`    | FsBlobStore                                           |
| `tests/user-store_test.ts`       | InMemoryUserStore                                     |
| `tests/module-loader_test.ts`    | Module scanning, manifest, validation                 |
| `tests/main-routes_test.ts`      | Health, SSE, dashboard auth guard, route registration |
| `tests/layout_test.tsx`          | Conduit layout rendering                              |

---

## Codebase Map

```
main.ts              — Server entrypoint
src/
  core/
    app-state.ts     — AppState + AuthBundle interfaces
    auth.ts          — JWT, cookies, middleware factories
    conduit.ts       — JSX rendering (Datastar-aware)
    config.ts        — BlennyConfig (composite provider)
    crypto.ts        — deriveKey (PBKDF2/SHA-256)
    database.ts      — SurrealDB connect (root-level NS/DB creation)
    db-connection.ts — Low-level connection helper
    db-guard.ts      — requireDb() / withDb()
    db-live.ts       — SurrealDB live queries
    db-manager.ts    — Connection lifecycle
    db-query.ts      — Query helpers
    envelope.ts      — Wire envelope types
    store.ts         — UserStore + BlobStore interfaces
    surreal-store.ts — SurrealUserStore (SurrealQL, argon2, bucket avatars)
    sqlite-user-store.ts — SqliteUserStore (bun:sqlite)
    sqlite-store.ts  — openSqliteStore(dbPath, blobStore)
    fs-blob-store.ts — FsBlobStore (filesystem)
    user-store.ts    — InMemoryUserStore (testing)
    module-loader.ts — Filesystem scanner + manifest support
    hub.ts           — TransportHub + typed event bus
    publisher.ts     — BlennyPublisher static class
    sse-connection.ts— SseConnection (Datastar SDK)
    layout.tsx       — DefaultLayout
    nav-link.tsx     — NavLink component
    validation.ts    — Valibot schemas + escapeHtml
    tracing.ts       — OTel no-op stub (deferred; loud under strict)
    rate-limiter.ts  — Token-bucket rate limiter
    error.ts         — BlennyError + structured error responses
    task-supervisor.ts — Supervised background tasks
    ws.ts            — WebSocket handlers
    bootstrap/
      config.ts      — loadConfig, checkJwtSecret
      services.ts    — createServices (Hono, hub, conduit, state)
      modules.ts     — discover, conflicts, initialize, routes, events
      middlewares.ts — CORS, CSRF, rate limiters, body limit, error/not-found
      endpoints.ts   — health, SSE, WS, static files
      server.ts      — Bun.serve with graceful shutdown
      routing.ts     — withRouteSpan (tracing wrapper)
  lib/
    avatar/
      service.ts      — AvatarService interface
      blob-store.ts   — BlobStoreAvatarService (wraps BlobStore)
      surreal.ts      — SurrealBucketAvatarService
      handlers.ts     — createHandleAvatarUpload / createHandleAvatarServe
  modules/
    auth/
      form-auth-surreal/ — Active auth module (SurrealDB, bucket avatars)
      .form-auth-kv/     — Disabled auth module (SQLite + FsBlobStore)
      user-admin/        — Admin user management
      password-change.tsx
    dashboard.tsx     — Dashboard with profile link
    demo/              — Datastar SSE + WS demo (transport.ts, tasks.ts)
    index.ts          — Root page
    manifest.ts       — Auto-generated (gitignored); static import manifest
tools/
  generate-manifest.ts — Scans modules/, generates manifest.ts
  init.ts              — Scaffolds a new project (package.json/tsconfig/bunfig)
tests/                 — One per module/core file
```

---

## Common Pitfalls

- **`Response` accepts `Uint8Array` directly** — no need for `bytes.buffer`.
- **`ArrayBuffer` from CBOR** — SurrealDB SDK returns `ArrayBuffer`, not
  `Uint8Array` for binary. Check `raw instanceof ArrayBuffer`.
- **`csrf()` blocks POST without `Origin`** — curl testing needs
  `-H "Origin: ..."`.
- **Bucket `f'path'.put/get`** — requires `--experimental-files` on the SurrealDB
  server.
- **`requireDb` throws** — fails fast if SurrealDB is needed but not connected.
  Use `withDb` for optional ops.
- **SurrealQL scalars** — `RETURN <expr>` returns `[value]`, not `[[value]]`.
  Destructure `[result]`.
- **Schema fields empty string** — `avatarKey`/`avatarMimeType` are
  `TYPE string DEFAULT ''` because SCHEMAFULL rejects `NONE`. `mapUser` converts
  `""` → `undefined`.
- **`avatarKey` is optional, not nullable** — `UserSchema.avatarKey` is
  `v.optional(v.string())`; `SqliteUserStore` omits the key when the column is
  `NULL` (never sets it to `null`).
- **Bun `File.type` appends a charset** — e.g. `"text/plain;charset=utf-8"`.
  Assert against `file.type`, not a literal `"text/plain"`.
- **`c.env` under Hono + `Bun.serve`** is the Bun server instance — use
  `c.env.requestIP(c.req.raw)?.address` (with a `c.env.server?.requestIP`
  fallback) for client IPs.
- **Nested `test()` is forbidden in Bun** — use the global `step()` helper.
- **HCaptcha config** — `form-auth.hcaptcha.secret` uses `at()` with
  dot-separated keys.
- **Module init order comes from capabilities, not filesystem order** — Deno
  `readDir` and Node `readdir` return entries in different orders, so a module
  that needs another module's `initialize()` side effects (e.g. `state.store`)
  MUST declare `requires: ["<capability>"]`. `dashboard` declares
  `requires: ["auth"]` for this reason.

---

## Gaps vs blenny-rs

| Priority | Gap                                                | Status  |
| -------- | -------------------------------------------------- | ------- |
| **High** | Transport auth required by default                 | ✅ Done |
| **High** | Anti-fragile middleware (BlennyError, 404 handler) | ✅ Done |
| **Low**  | `broadcastData` intent tagging                     | ✅ Done |
