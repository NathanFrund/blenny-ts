# Production Readiness

Checklist and implementation plan for taking blenny-ts from development to
production.

---

## Priority 1: Block the default JWT secret at boot

**Status:** ✅ Complete

**File:** `main.ts`

If `auth.jwt_secret` is still the embedded placeholder
`"CHANGE-ME-EMBEDDED-DEFAULT"` and the server is not in dev mode, exit
immediately with a clear error.

**Implementation:**

- After `new BlennyConfig()`, check the secret value.
- If unchanged and !devMode, write to stderr and `Deno.exit(1)`.
- Dev mode bypasses so `deno run` still works out of the box.

---

## Priority 2: Guard every `conn.send()` with try/catch

**Status:** ✅ Complete

**File:** `src/core/hub.ts`

Without this, a single dead connection throws and the entire broadcast `for`
loop aborts — all other clients miss the message.

**Implementation:**

- Wrap `conn.send(msg)` in the private `write()` method with `try/catch`.
- On catch, call `this.removeConnection(conn.id)` to reap the dead connection.
- Deleting from a `Map` during `values()` iteration is safe per the JS spec.

---

## Priority 3: Add CORS middleware

**Status:** ✅ Complete

**File:** `main.ts`

Any cross-origin frontend (HTMX client on a different port/domain) is silently
blocked without this.

**Implementation:**

- Import `cors` from `@hono/hono/cors`.
- Apply `app.use(cors({ origin: config.corsOrigin }))` before all routes.
- Origin configurable via `cors.origin` key (defaults to empty string, strict
  same-origin).

---

## Priority 4: Connection limits + zombie reaper

**Status:** ✅ Complete

**Files:** `src/core/hub.ts`, `src/core/sse-connection.ts`, `main.ts`

Without limits, a few thousand open SSE sockets exhaust memory. Without a
reaper, zombie connections from crashed tabs accumulate indefinitely.

**Implementation:**

1. `TransportHub` constructor accepts `{ maxConns, maxConnsPerUser }` (defaults
   10_000 / 100).
2. `registerConnection()` checks both limits before registering.
3. `SseConnection` tracks `lastWriteAt`, updated on every `send()`.
4. After `platform:ready`, `hub.startReaper()` runs a `setInterval` sweeping
   every 30s, removing SSE connections idle for >5 minutes.
5. Config keys: `transport.max_connections`, `transport.max_per_user`,
   `transport.idle_timeout_ms`.

---

## Priority 5: Fix SSE abort race

**Status:** ✅ Complete

**File:** `main.ts`

If `c.req.raw.signal` is already `aborted` when the SSE handler runs,
`addEventListener` never fires and the connection leaks.

**Implementation:**

- At the top of the SSE stream callback, check `c.req.raw.signal.aborted`.
- If already aborted, return immediately without opening a connection.

---

## Priority 6: Request body size limit

**Status:** ✅ Complete

**File:** `main.ts`

Large POST bodies are accepted without limit, opening a resource-exhaustion
vector.

**Implementation:**

- Add `bodyLimit` middleware from Hono.
- Reject requests exceeding configurable limit (default 1 MB) with 413.
- Config key: `server.max_body_bytes`.

---

## Priority 7: Rate-limit real-time transports

**Status:** ✅ Complete

**Files:** `src/core/rate-limiter.ts`, `main.ts`

Without rate limiting, `/sse` and `/ws` endpoints can be hammered with
connection requests, overwhelming the server.

**Implementation:**

- In-memory fixed-window rate limiter per IP, configurable via
  `ratelimit.window_ms` (default `60000`) and `ratelimit.max_requests` (default
  `30`).
- Applies to `/sse` and `/ws` before any transport logic runs.
- Returns `429 Too Many Requests` with JSON error body
  (`{ error: { type: "too_many_requests", message } }`) and `Retry-After`
  header.
- Client IP resolved from `x-forwarded-for` or `x-real-ip` header (set these in
  your reverse proxy).
- Separate auth limiter for `/auth/*` with tighter window.
- Rate limit values validated via `getNumeric()` with range bounds at boot.

---

## Priority 8: Module test coverage

**Status:** ✅ Complete

**Files:** `tests/hello_test.ts`, `tests/demo_test.ts`,
`tests/simulation_test.ts`

Core module routes and lifecycle hooks are tested:

- `hello` — GET `/` returns HTML, GET `/hello` returns text
- `demo` — GET `/demo` returns HTML, trigger-broadcast endpoints, POST
  `/demo/broadcast`
- `simulation` — GET `/simulation/status`, `start()` publishes `spatial:tick`,
  `stop()` clears timer

---

## Priority 9: Core test coverage

**Status:** ✅ Complete

**Files:** `tests/module-loader_test.ts`, `tests/validation_test.ts`,
`tests/user-store_test.ts`, `tests/layout_test.tsx`

Core infrastructure modules have dedicated tests:

- `module-loader` — loads all 5 modules, validates route shapes, lifecycle
  hooks, capabilities
- `validation` — SignalSchema (rejects arrays/null/primitives), UsernameSchema,
  PasswordSchema, UserInfoSchema
- `user-store` — CRUD operations, password verification, duplicate detection,
  role defaults
- `layout` — DefaultLayout renders slot content and HTMX script tag

---

## Priority 10: Wire UsernameSchema/PasswordSchema into form-auth

**Status:** ✅ Complete

**File:** `src/modules/form-auth/`

Registration now validates username and password against Valibot schemas before
creating the user:

- Empty username returns "Username is required"
- Passwords under 8 characters return "Password must be at least 8 characters"
- Overly long values are rejected with descriptive messages

---

## Priority 11: Capabilities system

**Status:** ✅ Complete

**Files:** `src/types.ts`, `src/core/module-loader.ts`, `main.ts`,
`src/modules/form-auth/`

- `BlennyModule` interface now has optional `capabilities?: string[]`
- `module-loader.ts` validates capabilities as arrays of strings
- `main.ts` detects capability conflicts at boot (e.g., two modules declaring
  `"auth"`) and throws
- `form-auth` module declares `capabilities: ["auth"]`

---

## Priority 12: Rate limit numeric validation

**Status:** ✅ Complete

**File:** `src/core/config.ts`

Rate limit config values now use typed getters with `getNumeric()` range
validation:

- `ratelimit.window_ms` — validated between 100ms and 1 hour
- `ratelimit.max_requests` — validated between 1 and 100,000
- `ratelimit.auth_window_ms` — validated between 100ms and 1 hour
- `ratelimit.auth_max_requests` — validated between 1 and 100,000

Invalid values throw a clear boot-time error instead of producing NaN behavior.

---

## Priority 13: Admin credentials warning

**Status:** ✅ Complete

**File:** `src/modules/form-auth/`

When the default admin user is seeded outside of dev mode, a log warning is
emitted:

```
WARN: Default admin credentials (admin/admin) are in use — change them immediately
```

---

## Priority 14: SSE abort check in test handler

**Status:** ✅ Complete

**File:** `tests/main-routes_test.ts`

The test SSE handler now includes the `c.req.raw.signal.aborted` check at the
top of the stream callback, matching the production handler in `main.ts`.

---

## Verification

Run the full suite:

```bash
deno check main.ts src/ tests/
deno lint
deno test --allow-read --allow-env
```
