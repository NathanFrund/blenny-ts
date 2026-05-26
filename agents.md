# Blenny-ts — Agent Briefing

A Deno/TypeScript port of the Blenny framework (Pharo Smalltalk → Rust → Clojure → TS).
Hypermedia-driven, real-time, single-binary platform.

---

## Key Idioms & Patterns

### Modules
- Drop `.ts`/`.tsx` into `src/modules/` with a default export matching `BlennyModule`.
- Auto-discovered at boot by `module-loader.ts` (filesystem scan, dynamic `import()`).
- Use `const myModule: BlennyModule = { ... }; export default myModule;` — never `satisfies`.
- Lifecycle hooks: `initialize(state)`, `start()`, `stop()`.
- Module declares capabilities like `capabilities: ["auth"]` to signal what it provides.
- Routes have an optional `auth` field (`true` for any user, `"role"` for role check).

### AppState
- Single object injected into modules during `initialize(state)`.
- Contains: `hub`, `conduit`, `config`, optional `auth` (set by auth module), optional `db` (SurrealDB).

### TransportHub
- Central connection manager. Three maps: global connections, per-user connections, per-topic subscribers.
- `Connection` interface: `{ id, userId?, intents?, send(msg) }`.
- Two implementations: `SseConnection` (Datastar SDK framing) and `WsConnection` (bare HTML/JSON/script).
- Connections registered per-tab via `crypto.randomUUID()`. Cleanup on `AbortSignal`.

### BlennyPublisher
- Static class for zero-ceremony broadcasting from any code.
- Four methods: `broadcastHtml`, `directHtml`, `broadcastData`, `directData`.
- Initialized once at boot via `BlennyPublisher.init(hub)`. Testable via `BlennyPublisher.reset()`.
- `broadcastHtml`/`directHtml` delegate to `hub.patchElements()`.
- `broadcastData`/`directData` parse JSON internally and delegate to `hub.mergeSignals()`.

### Auth
- Pluggable by convention: a module sets `state.auth` (an `AuthBundle`) during `initialize()`.
- `AuthBundle` provides `middleware` (global JWT reader), `requireUser`, `requireRole`.
- `main.ts` checks `state.auth` after initialization — at most one module should set it.
- Capabilities declaration `capabilities: ["auth"]` enables boot-time conflict detection.
- Reference implementation: `form-auth.tsx` (SHA-256, registration, JWT cookies).

### Conduit
- HTMX-aware JSX renderer. Returns fragment on HTMX swaps, full layout on page loads.
- Detection: `c.req.header("HX-Request") !== undefined`.
- Per-response layout override: `conduit.respond(c, content, { layout })`.
- JSX types bridged via `as unknown as string` (zero `any` in source).

### Config
- Composite provider: CLI args > env vars (`BLENNY_<KEY>`) > `blenny.json` > embedded defaults.
- Constructed once at boot. Test injection via `ConfigOverrides`.
- Convenience getters: `config.port`, `config.jwtSecret`, `config.surrealUrl`, etc.
- Raw access: `config.at("any.dotted.key")`.

### SSE/WS Handler Symmetry
- Both endpoints parse `?intent=` for connection-level routing.
- Both extract `userId` from JWT cookie or `?token=` query param.
- `SseConnection` wraps `ServerSentEventGenerator.stream()` with keepalive.
- `WsConnection` wraps `upgradeWebSocket()` with `onOpen`/`onMessage`/`onClose`.

---

## Important Decisions & Rationale

| Decision | Why |
|----------|-----|
| **SDK over custom encoder** | Official `@starfederation/datastar-sdk` replaces all encoder code. No custom wire format to maintain. |
| **Capabilities on BlennyModule** | Self-declaring modules enable boot-time conflict detection for auth (and future providers). |
| **BlennyPublisher (static)** | Zero-ceremony broadcasting from any code, matching Smalltalk/Rust/Clojure pattern. |
| **Hub stays alongside publisher** | Publisher covers 80% of cases; hub is still there for intent-level control. |
| **Zero `any` in source** | `as unknown as X` casts where bridging is needed (JSX, JWT). Test files may use `as any` with lint ignores. |
| **UUID-per-tab connections** | Clean per-tab tracking, deduplication, and cleanup via `AbortSignal`. |
| **Connection is a `send()` interface** | Hub doesn't hold writers directly. SSE and WS each implement `send()` differently. |
| **Auth via convention, not trait** | A module sets `state.auth`. The framework doesn't define an auth trait — modules are the strategy. |
| **Passive framework** | No baked clock or tick loop. All active logic lives in module `start()`/`stop()`. |
| **Layout per-response** | `Conduit.respond(c, content, { layout })` — flexible per-call, no framework magic. |
| **No `enabled` flag** | Removed. If a module's file is in `modules/`, it runs. Deployment policy is an operator concern. |

---

## Architectural Guardrails & Invariants (DO NOT REFACTOR AWAY)

To prevent regression during automated refactoring, agents must preserve:

### Module Lifecycles & Self-Assembly
- **No Manual Main Wiring:** `main.ts` must remain purely infrastructure. Never add explicit module initialization. Modules self-assemble via filesystem discovery.
- **Lifecycle Hooks:** Every module must respect `initialize`, `start`, and `stop` hooks.
- **BlennyModule annotation:** Use `const x: BlennyModule = { ... }` — never `satisfies` or inferred types for module declarations.

### Transport & Real-Time Defaults
- **SSE Always Active:** SSE must always be functional. WebSocket is a sidecar, never a replacement.
- **BlennyPublisher Exposed:** `broadcastHtml`, `directHtml`, `broadcastData`, `directData` must be available from any code. Do not encapsulate behind module instances.
- **Intent Routing:** Messages must retain intent-based filtering (`ui`, `data`, `command`, `notification`). Do not remove or collapse the intent system.
- **Datastar SDK Only:** The official `@starfederation/datastar-sdk` is the sole SSE wire format. No custom encoder logic.
- **WS Sends Bare Payloads:** WebSocket delivers HTML/JSON/script directly — no SSE framing.

### Rendering & Assets
- **Conduit for JSX:** All HTML responses must pass through `Conduit` for HTMX-aware fragment/layout handling.
- **Per-Response Layout:** `respond()` must accept an `opts.layout` override. Module-level defaults are documentation-only.

### Security & Infrastructure
- **Auth by Convention:** Auth is always a module that sets `state.auth`. The framework must not hardcode auth logic.
- **Config via Composite Provider:** CLI > env > file > defaults. No single-source config.
- **Zero Config Coupling:** No framework code reads `Deno.env` or `Deno.args` directly — all paths go through `BlennyConfig`.

---

## Current State (May 2026)

- Core framework fully implemented: modules, hub, SSE, WS, conduit, config, auth, database.
- BlennyPublisher for zero-ceremony real-time pushes.
- 30 source files, 9 test files, 79 test steps — all passing.
- `deno check` and `deno lint` clean across all files.
- Three known gaps vs blenny-rs (see Gaps vs blenny-rs below).

---

## Code Style & Idioms

- **Formatting:** `deno fmt` (2-space indent, 120 char width).
- **Type Checking:** `deno check` must pass with zero errors.
- **Linting:** `deno lint` must pass with zero warnings.
- **Zero `any`:** No `any` in source files (`src/`). Test files (`tests/`) may use `as any` with `// deno-lint-ignore no-explicit-any`.
- **Imports:** Always explicit file extensions (`.ts`, `.tsx`). Group: std lib, external deps, internal modules.
- **Naming:** PascalCase for types/classes/interfaces, camelCase for functions/variables, kebab-case for files.

---

## Testing

All tests: `deno test --allow-read --allow-env`

### Patterns
- **HTTP-level tests:** Use Hono's `app.request()` — no port binding needed.
- **WS tests:** Cannot use `app.request()`. Test `WsConnection.send()` and `dispatchWsMessage()` in isolation.
- **Config tests:** Pass `ConfigOverrides` to `BlennyConfig` — no global env mutation.
- **Auth tests:** Build an app with `form-auth.tsx`, seed admin user via async `initialize()`.
- **Publisher tests:** Call `BlennyPublisher.reset()` between test cases.

### Test files
| Test | What it covers |
|------|----------------|
| `tests/auth_test.ts` | JWT sign/verify, cookie helpers, middleware redirects/roles |
| `tests/conduit_test.tsx` | Layout wrapping, HTMX fragment detection |
| `tests/config_test.ts` | Defaults, overrides, priority, edge cases |
| `tests/db-guard_test.ts` | `requireDb`/`withDb` behavior |
| `tests/form-auth_test.ts` | Registration, sign-in, sign-out, auth guard |
| `tests/hub_test.ts` | Connection lifecycle, broadcast, direct, intent filtering |
| `tests/main-routes_test.ts` | Health, SSE, dashboard auth guard, token binding |
| `tests/publisher_test.ts` | Init/reset lifecycle, broadcast, direct, JSON parsing |
| `tests/ws_test.ts` | WsConnection.send(), dispatchWsMessage() |

---

## How to Navigate the Codebase

```
main.ts              — Server entrypoint, lifecycle orchestration
src/
  core/
    app-state.ts     — AppState + AuthBundle interfaces
    auth.ts          — JWT primitives, cookie helpers, middleware factories
    conduit.ts       — Conduit class (JSX rendering, layout overrides)
    config.ts        — BlennyConfig (composite provider)
    database.ts      — connectDatabase() helper
    db-guard.ts      — requireDb() / withDb() for optional DB
    envelope.ts      — ServerMessage, Intent types
    hub.ts           — TransportHub + typed event bus (publish/subscribe)
    layout.tsx       — DefaultLayout JSX component
    module-loader.ts — Filesystem module scanner
    publisher.ts     — BlennyPublisher static class
    sse-connection.ts — SseConnection wrapping Datastar SDK
    user-store.ts    — In-memory user store (SHA-256)
    ws.ts            — WsConnection, dispatchWsMessage, createWsHandler
  modules/
    dashboard.tsx    — Conduit rendering demo with sign-out form
    demo.ts          — Datastar-first SSE + WS test page
    form-auth.tsx    — Auth module (registration, login, sign-out)
    hello.ts         — Root page module
    simulation.ts    — Tick loop module (lifecycle hooks demo)
  types.ts           — Route, BlennyModule, BlennyEvents interfaces
tests/               — One test file per module/core file
blenny.example.json  — Documented config keys with defaults
deno.json            — Task definitions, imports, JSX config
```

---

## Common Pitfalls

- **Hono JSX types:** `c.html()` expects `string`, not JSX. Use `content as unknown as string` to bridge. Never use `any`.
- **`HX-Request` header:** `c.req.header("HX-Request")` returns `undefined` (not `null`) when absent. Check `!== undefined`.
- **`c.html()` return type:** Returns `Response | Promise<Response>`. JSX content wrapped in a function returns a Promise.
- **ServerSentEventGenerator.stream():** Must return a `Promise<void>` that resolves on abort. The `c.req.raw.signal` abort listener calls `cleanup()` then `resolve()`.
- **WS `upgradeWebSocket`:** The `ws` argument is `WSContext` (not native `WebSocket`). Has `.send()`, `.close()`, `.readyState`.
- **WS tests:** Cannot test via `app.request()`. Test connection logic and message dispatch in isolation.
- **User-store singleton:** `createUserStore()` returns a singleton Map shared across all imports. Admin user seeded once on first `initialize()`.
- **Config test injection:** Use `ConfigOverrides.fileContent` (a JSON string) or `ConfigOverrides.env`/`ConfigOverrides.args`. Not `ConfigOverrides.args` — actually `args` in `ConfigOverrides`.
- **`buildApp()` is async:** Auth module's `initialize()` is async (SHA-256 seeding). All test app builders must `await`.
- **`handleSignOut()` is synchronous:** Uses `c.get("user")` which returns `undefined` when unauthenticated. No `await` needed.
- **`Keepalive` type:** The `@starfederation/datastar-sdk/web` module may not export `KeepaliveOptions`. Pass `{ keepalive: true }` as literal.

---

## Gaps vs blenny-rs

| Priority | Gap | Status |
|----------|-----|--------|
| **High** | **Transport auth required by default** — `/sse` and `/ws` reject unauthenticated connections. Config flag `transport.auth_required` to disable. | ✅ Done |
| **High** | **Anti-fragile middleware** — Global error boundary catching uncaught exceptions and returning structured JSON errors. | ⬜ Not started |
| **Low** | **`broadcastData` intent tagging** — Tag messages with intent `"data"` instead of no tag. | ⬜ Not started |
