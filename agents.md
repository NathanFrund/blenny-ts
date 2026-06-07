# Blenny-ts — Agent Briefing

Deno/TypeScript port of the Blenny framework. Hypermedia-driven, real-time, single-binary platform.

---

## Key Idioms & Patterns

### Modules

- Drop `.ts`/`.tsx` into `src/modules/` or directory with `index.ts`/`index.tsx`.
- Directory modules: `module-loader.ts` scans for `index.ts`/`index.tsx` inside.
- Dot-prefixed entries (`src/modules/.foo/`) are **skipped** by the loader — used for disabled/inactive modules that are importable by explicit path.
- Auto-discovered at boot by `module-loader.ts` (filesystem scan or manifest for compiled binaries).
- `const myModule: BlennyModule = { ... }; export default myModule;` — never `satisfies`.
- Lifecycle hooks: `initialize(state)`, `start()`, `stop()`.
- Capabilities: `capabilities: ["auth"]` for boot-time conflict detection.
- Routes: `{ method, path, handler, auth? }` — `auth: true` activates auth guard, `auth: "role"` for role check.

### AppState

- Single object injected into modules during `initialize(state)`.
- Contains: `hub`, `conduit`, `config`, `conduit`, optional `auth` (set by auth module), optional `db` (SurrealDB).

### TransportHub

- Central connection manager. `registerConnection` / `unregisterConnection`.
- Two connection types: `SseConnection` (Datastar SDK) and `WsConnection` (raw HTML/JSON/script).
- Per-tab connections via `crypto.randomUUID()`. Cleanup on `AbortSignal`.

### BlennyPublisher

- Static class for zero-ceremony real-time pushes: `broadcastHtml`, `directHtml`, `broadcastData`, `directData`.
- Initialized once at boot via `BlennyPublisher.init(hub)`. Testable via `BlennyPublisher.reset()`.

### Pub-Sub Logging

- Components publish via `publish("log", { level, template, args })`.
- `createLogger` subscribes to `"log"` events in one place and forwards to LogTape.
- `requestLogger()` middleware also uses the bus.

### Auth

- Two peer modules; only one can be active (both declare `capabilities: ["auth"]`):
  - **`form-auth-kv/`** — KV-backed, Deno Deploy compatible, zero infra (currently active)
  - **`.form-auth-surreal/`** (dot-prefixed, disabled) — SurrealDB-backed, argon2 via SurrealQL, bucket-based avatar storage
- A module sets `state.auth` (an `AuthBundle`) during `initialize()`.
- `AuthBundle` provides `middleware` (global JWT reader), `requireUser`, `requireRole`.
- `main.ts` checks `state.auth` after initialization.
- Profile page at `/auth/profile` with avatar display and upload form.

### Conduit

- Datastar-aware JSX renderer. Returns fragment on Datastar SSE merges, full layout on page loads.
- Detection: `c.req.header("HX-Request") !== undefined` (HTMX) or Datastar signals.
- Per-response layout override: `conduit.respond(c, content, { layout })`.

### Config

- Composite provider: CLI args > env vars (`BLENNY_<KEY>`) > `blenny.json` > embedded defaults.
- Convenience getters: `config.port`, `config.jwtSecret`, `config.surrealUrl`, etc.
- Raw access: `config.at("any.dotted.key")`.

### Validation

- **`src/core/validation.ts`** — Valibot schemas: `SignalSchema`, `UsernameSchema`, `PasswordSchema`.
- `escapeHtml()` re-exported from `@std/html/entities`.

### Database

- Optional SurrealDB connection. `state.db` is `Surreal | undefined`.
- `requireDb()` / `withDb()` in `db-guard.ts` for fail-fast or graceful fallback.
- `database.ts` connects at root level, creates NS/DB, then `use()` them.
- SurrealDB v3 SDK v2 — CBOR codec, returns `ArrayBuffer` for binary data (not `Uint8Array`).

### UserStore & BlobStore

- `UserStore` interface: 6 methods — `findById`, `findByUsername`, `createUser`, `updatePasswordHash`, `updateAvatarKey`, `deleteUser`.
- Implementations: `SurrealUserStore` (SurrealQL + argon2 server-side), `KvUserStore` (Deno.KV), `InMemoryUserStore` (tests).
- `BlobStore` interface: `set`, `get`, `getAsResponse`, `delete`, `list`.
- Implementations: `KvBlobStore` (Deno.KV), `FsBlobStore` (filesystem).

---

## Boot Order (`main.ts`)

1. Load config + check JWT secret
2. Create services (Hono app, hub, conduit, state, supervisor)
3. Setup database (connect SurrealDB or Deno.KV)
4. Configure middleware (CORS, CSRF, rate limiters, body limit)
5. Configure error handler + not-found handler
6. Discover modules (scan or manifest.ts)
7. Detect capability conflicts
8. Initialize modules (calls `initialize()`)
9. Apply auth middleware globally
10. Register module routes
11. Subscribe module events
12. Start modules (calls `start()`)
13. Register platform endpoints (health, SSE, WS, static)
14. Start server (`Deno.serve()`)

---

## Important Decisions & Rationale

| Decision | Why |
|----------|-----|
| **Auth via convention** | A module sets `state.auth`. No framework trait. |
| **SDK over custom encoder** | Official `@starfederation/datastar-sdk` replaces all encoder code. |
| **Capabilities** | Self-declaring enables boot-time conflict detection (e.g., dual auth). |
| **BlennyPublisher (static)** | Zero-ceremony broadcasting from any code. |
| **Dot-prefix disable** | `module-loader.ts` skips entries starting with `.` — simple toggle. |
| **CBOR ArrayBuffer** | SurrealDB SDK v2 CBOR decoder returns `ArrayBuffer` for byte strings, not `Uint8Array`. |
| **SurrealDB argon2** | Password hashing done server-side via `crypto::argon2::generate/compare`. No app-side crypto. |
| **Bucket ops try/catch** | `DEFINE BUCKET` requires `--experimental-files`; gracefully degraded. |
| **Passive framework** | No baked clock. All active logic lives in module `start()`/`stop()`. |

---

## Architectural Guardrails

### Module Lifecycles

- **No Manual Main Wiring** — modules self-assemble via filesystem discovery.
- **Lifecycle Hooks** — respect `initialize`, `start`, `stop`.

### Transport

- **SSE Always Active** — WebSocket is a sidecar, never a replacement.
- **Datastar SDK Only** — `@starfederation/datastar-sdk` is the sole SSE wire format.
- **Intent Routing** — Messages retain `ui`, `data`, `command`, `notification` filtering.
- **No HTMX** — Not used. Datastar for real-time, plain HTML forms for auth.

### Security

- **Auth by Convention** — always a module that sets `state.auth`.
- **Config via Composite Provider** — CLI > env > file > defaults.
- **CSRF Protection** — `csrf()` middleware blocks POST without `Origin` header.

---

## Current State (June 2026)

- Full framework: modules, hub, SSE, WS, conduit, config, auth (two peers), SurrealDB database, blob storage.
- 67 test files/222 steps passing, 1 ignored (surreal-store without `BLENNY_SURREAL_URL`).
- `deno check` and `deno lint` clean.
- Compiled binaries: manifest.ts support for route registration without filesystem scan.

---

## Code Style

- **Formatting:** `deno fmt` (2-space indent, 120 char width).
- **Type Checking:** `deno check` — zero errors.
- **Linting:** `deno lint` — zero warnings.
- **Zero `any`:** No `any` in source files (`src/`). Test files (`tests/`) may use `as any` with `// deno-lint-ignore`.
- **Imports:** Always explicit file extensions (`.ts`, `.tsx`). Group: std lib, external deps, internal modules.

---

## Testing

```bash
deno test --allow-read --allow-env --allow-write --unstable-kv
```

### Key test files

| Test | What it covers |
|------|----------------|
| `tests/form-auth_test.ts` | Registration, sign-in, sign-out, auth guard |
| `tests/surreal-store_test.ts` | SurrealUserStore (gated behind `BLENNY_SURREAL_URL`) |
| `tests/kv-store_test.ts` | KvUserStore, KvBlobStore |
| `tests/fs-blob-store_test.ts` | FsBlobStore |
| `tests/user-store_test.ts` | InMemoryUserStore |
| `tests/module-loader_test.ts` | Module scanning, manifest, validation |
| `tests/main-routes_test.ts` | Health, SSE, dashboard auth guard, route registration |
| `tests/layout_test.tsx` | Conduit layout rendering |

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
    database.ts      — SurrealDB connect (root-level NS/DB creation)
    db-guard.ts      — requireDb() / withDb()
    store.ts         — UserStore + BlobStore interfaces
    surreal-store.ts — SurrealUserStore (SurrealQL, argon2, bucket avatars)
    kv-store.ts      — KvUserStore + KvBlobStore
    fs-blob-store.ts — FsBlobStore (filesystem)
    user-store.ts    — InMemoryUserStore (testing)
    module-loader.ts — Filesystem scanner + manifest support
    hub.ts           — TransportHub + typed event bus
    publisher.ts     — BlennyPublisher static class
    layout.tsx       — DefaultLayout
    validation.ts    — Valibot schemas
    tracing.ts       — OpenTelemetry spans
    rate-limiter.ts  — Token-bucket rate limiter
    error.ts         — BlennyError + structured error responses
    bootstrap/
      config.ts      — loadConfig, checkJwtSecret
      services.ts    — createServices (Hono, hub, conduit, state)
      modules.ts     — discover, detect conflicts, initialize, register routes
      middlewares.ts  — CORS, CSRF, rate limiters, body limit, error/not-found handlers
      endpoints.ts   — health, SSE, WS, static files
      server.ts      — Deno.serve with graceful shutdown
      routing.ts     — withRouteSpan (tracing wrapper)
  lib/
    avatar/
      service.ts      — AvatarService interface
      blob-store.ts   — BlobStoreAvatarService (wraps BlobStore)
      handlers.ts     — createHandleAvatarUpload / createHandleAvatarServe factories
  modules/
    .form-auth-surreal/ — Disabled auth module (SurrealDB, bucket avatars)
      surreal.ts      — SurrealBucketAvatarService
    form-auth-kv/       — Active auth module (KV, Deno Deploy)
    dashboard.tsx     — Dashboard with profile link
    demo.ts           — Datastar SSE + WS demo
    index.ts          — Root page
    manifest.ts       — Auto-generated (gitignored); static import manifest for compiled binaries
  tools/
    generate-manifest.ts — Scans modules/, generates manifest.ts
modes/                 — MCP-like mode system (detached editor, field codex)
tests/                 — One per module/core file
```

---

## Common Pitfalls

- **`Response` accepts `Uint8Array` directly** — no need for `bytes.buffer`.
- **`ArrayBuffer` from CBOR** — SurrealDB SDK returns `ArrayBuffer`, not `Uint8Array` for binary. Check `raw instanceof ArrayBuffer`.
- **`csrf()` blocks POST without `Origin`** — curl testing needs `-H "Origin: ..."`.
- **Bucket `f'path'.put/get`** — requires `--experimental-files` on SurrealDB server.
- **`requireDb` throws** — fails fast if SurrealDB needed but not connected. Use `withDb` for optional ops.
- **SurrealQL scalars** — `RETURN <expr>` returns `[value]`, not `[[value]]`. Destructure `[result]`.
- **Schema fields empty string** — `avatarKey`/`avatarMimeType` are `TYPE string DEFAULT ''` because SCHEMAFULL rejects `NONE`. `mapUser` converts `""` → `undefined`.
- **HCaptcha config** — `form-auth.hcaptcha.secret` uses `at()` with dot-separated keys.

---

## Gaps vs blenny-rs

| Priority | Gap | Status |
|----------|-----|--------|
| **High** | Transport auth required by default | ✅ Done |
| **High** | Anti-fragile middleware (BlennyError, 404 handler) | ✅ Done |
| **Low** | `broadcastData` intent tagging | ✅ Done |
