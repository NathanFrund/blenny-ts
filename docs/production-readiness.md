# Production Readiness

Checklist and implementation plan for taking blenny-ts from development to production.

---

## Priority 1: Block the default JWT secret at boot

**File:** `main.ts`

If `auth.jwt_secret` is still the embedded placeholder `"CHANGE-ME-EMBEDDED-DEFAULT"` and the server is not in dev mode, exit immediately with a clear error.

**Implementation:**
- After `new BlennyConfig()`, check the secret value.
- If unchanged and !devMode, write to stderr and `Deno.exit(1)`.
- Dev mode bypasses so `deno run` still works out of the box.

---

## Priority 2: Guard every `conn.send()` with try/catch

**File:** `src/core/hub.ts`

Without this, a single dead connection throws and the entire broadcast `for` loop aborts — all other clients miss the message.

**Implementation:**
- Wrap `conn.send(msg)` in the private `write()` method with `try/catch`.
- On catch, call `this.removeConnection(conn.id)` to reap the dead connection.
- Deleting from a `Map` during `values()` iteration is safe per the JS spec.

---

## Priority 3: Add CORS middleware

**File:** `main.ts`

Any cross-origin frontend (HTMX client on a different port/domain) is silently blocked without this.

**Implementation:**
- Import `cors` from `@hono/hono/cors`.
- Apply `app.use(cors())` before all routes.
- Add `"server.cors_origin": "*"` to config defaults for future customization.

---

## Priority 4: Connection limits + zombie reaper

**Files:** `src/core/hub.ts`, `src/core/sse-connection.ts`, `main.ts`

Without limits, a few thousand open SSE sockets exhaust memory. Without a reaper, zombie connections from crashed tabs accumulate indefinitely.

**Implementation:**
1. `TransportHub` constructor accepts `{ maxConns, maxConnsPerUser }` (defaults 10_000 / 100).
2. `registerConnection()` checks both limits before registering.
3. `SseConnection` tracks `lastWriteAt`, updated on every `send()`.
4. After `platform:ready`, a `setInterval` sweeps connections every 60s, removing SSE connections idle for >5 minutes.
5. Config keys: `transport.max_connections`, `transport.max_per_user`, `transport.idle_timeout_ms`.

---

## Priority 5: Fix SSE abort race

**File:** `main.ts`

If `c.req.raw.signal` is already `aborted` when the SSE handler runs, `addEventListener` never fires and the connection leaks.

**Implementation:**
- At the top of the SSE stream callback, check `c.req.raw.signal.aborted`.
- If already aborted, return immediately without opening a connection.

---

## Priority 6: Request body size limit

**File:** `main.ts`

Large POST bodies are accepted without limit, opening a resource-exhaustion vector.

**Implementation:**
- Add a small middleware that checks `content-length` header.
- Reject requests exceeding 1 MB (configurable) with 413.
- Config key: `server.max_body_bytes`.

---

## Verification

After each priority:

```bash
deno check main.ts src/ tests/
deno lint
deno test --allow-read --allow-env
```
