# Migrating blenny-ts from Deno to Bun

## Goal

Replace the Deno runtime with Bun while preserving the architecture, public API, and
observable behavior. No refactors beyond what the runtime change requires. Tests are the
spec — a ported test that passes is the definition of done for that unit.

## Constraints

- Do not change `src/core/store.ts`. The `UserStore` / `BlobStore` interfaces are the
  abstraction that makes this migration tractable.
- Do not introduce new abstractions (no KV shim, no storage wrapper packages).
- No experimental dependencies (`db0`, `unstorage`, etc. are out).
- Preserve error messages exactly. Tests assert on strings like `"Username is already taken"`.
- Preserve the `fields?: string[]` parameter on `findById`/`findByUsername` even though the
  current implementation ignores it (`_fields`). It is part of the interface.
- Do not change the config precedence order: CLI > env > file > defaults.

## Storage decision: KV is gone, `bun:sqlite` replaces it

Deno KV had exactly two consumers: `tests/kv-store_test.ts` and the disabled
`src/modules/auth/.form-auth-kv/` module. It is deleted outright, not shimmed:

| Deno KV | Replacement |
|:--|:--|
| `KvUserStore` (kv get/set/atomic over `["users", id]`) | `SqliteUserStore` — `bun:sqlite` (built into Bun, zero deps), WAL mode, one `users` table, same `UserStore` methods, same error strings |
| Atomic CAS `check({versionstamp: null})` for duplicate usernames | `username TEXT UNIQUE` + INSERT constraint catch, rethrowing `"Username is already taken"` |
| `KvBlobStore` via `@kitsonk/kv-toolbox/blob` | Existing `FsBlobStore` (`data/blobs/`, bytes + `.type` sidecar). Avatars are bounded by `server.max_body_bytes` |
| `openKvStore(path?)` | `openSqliteStore(dbPath, blobStore)` → `{ db, store, blobStore }` |

- New files: `src/core/sqlite-user-store.ts`, `src/core/sqlite-store.ts`.
- Deleted: `src/core/kv-store.ts`, dependency `@kitsonk/kv-toolbox`.
- `avatarKey` trap: `UserSchema.avatarKey` is `v.optional(v.string())` (`validation.ts`),
  which rejects `null`. Rows are mapped through `rowToUserData`, which omits the key when
  the column is NULL (mirrors `surreal-store.ts`: `r.avatarKey || undefined`).
- `.form-auth-kv` is repointed: `driver === "kv"` branch → `openSqliteStore`, same
  `form-auth.db.path` config key (default `./data/blenny.sqlite`); `state.kv` removed.
- `SurrealUserStore`, `InMemoryUserStore`, and the `database.type` surreal driver are
  untouched. There is no data to migrate (this is the scaffolding core).

## Dependency mapping (`deno.json` imports → `package.json`)

Import specifiers in source are preserved via npm aliases. Versions are pinned to the
exact versions from `deno.lock` (not ranges):

| Specifier (unchanged in source) | package.json |
|:--|:--|
| `@hono/hono` (+ subpaths `/jsx`, `/jwt`, …) | `"@hono/hono": "npm:hono@4.12.23"` |
| `@valibot/valibot` | `"@valibot/valibot": "npm:valibot@1.4.1"` |
| `@surrealdb/surrealdb` | `"@surrealdb/surrealdb": "npm:surrealdb@2.0.3"` (2.1.1 breaks `db-live.ts` types) |
| `@logtape/logtape` | `"@logtape/logtape": "2.1.1"` (npm-native) |
| `@starfederation/datastar-sdk` | `"@starfederation/datastar-sdk": "1.0.0"` (already npm) |
| `@opentelemetry/api`, `@opentelemetry/sdk-trace-base` | **removed** (OTel deferred behind a loud stub; see below) |
| `@std/assert` | `"@std/assert": "npm:@jsr/std__assert@1.0.19"` — JSR via the npm registry mirror (`.npmrc` sets `@jsr:registry=https://npm.jsr.io`). Native `jsr:` specifiers fail on Bun 1.4.3. Test files unchanged |
| `@std/path` | **removed** → `node:path` / `node:url` |
| `@std/html` | **removed** → inline `escapeHtml` in `validation.ts` |
| `@kitsonk/kv-toolbox` | **removed** |
| `@blenny/types`, `@blenny/core/*`, `@blenny/lib/*` | tsconfig `paths` (Bun honors them at runtime) |

`tsconfig.json`: `jsx: "react-jsx"`, `jsxImportSource: "@hono/hono/jsx"` (the npm alias
path — bare `hono/jsx/jsx-runtime` does not resolve; replaces Deno's `jsx: "precompile"`),
`moduleResolution: "bundler"`, `allowImportingTsExtensions: true`.

## Runtime API reference

| Deno | Bun / Node |
|:--|:--|
| `Deno.env.get("X")` | `process.env.X` |
| `Deno.args` | `process.argv.slice(2)` |
| `Deno.cwd()` | `process.cwd()` |
| `Deno.exit(n)` | `process.exit(n)` |
| `Deno.addSignalListener("SIGINT", fn)` | `process.on("SIGINT", fn)` (handler must not assume zero args — Node passes the signal name) |
| `Deno.readDir(p)` | `readdir(p, { withFileTypes: true })` — **shape differs**: Deno yields `{name, isFile, isDirectory}` properties; Node `Dirent` has `isFile()` / `isDirectory()` **methods** |
| `Deno.stat(p)` | `stat(p)`; `stat.isFile` → `stat.isFile()` |
| `Deno.readTextFile` / `readFile` / `writeFile` / `writeTextFile` / `mkdir` / `remove` / `copyFile` | `node:fs/promises` equivalents (`rm`/`unlink` for remove) |
| `Deno.readTextFileSync` | `readFileSync(p, "utf-8")` |
| `Deno.realPathSync` | `realpathSync` |
| `Deno.makeTempDirSync` | `mkdtempSync(join(tmpdir(), "blenny-"))` |
| `Deno.errors.NotFound` | `err.code === "ENOENT"` — logic change, not a rename |
| `Deno.errors.PermissionDenied` | `err.code === "EACCES"` / `"EPERM"` |
| `Deno.hostname()` / `loadavg()` / `systemMemoryInfo()` | `node:os` (`hostname()`, `loadavg()`, `totalmem()`/`freemem()` — memory shape differs; docs example only) |
| `Deno.openKv` / `Deno.Kv` | **deleted** (see storage decision) |
| `import.meta.main` | works natively in Bun |
| `toFileUrl` / `fromFileUrl` (`@std/path`) | `pathToFileURL` / `fileURLToPath` (`node:url`) |

## Server and transport

- `Deno.serve` → `Bun.serve` in `src/core/bootstrap/server.ts`.
  - Bun's `ServeOptions` has **no** `onListen`: run the `platform:ready` publish, reaper
    start, and listening log immediately after `Bun.serve()` returns (`server.port` is live).
  - `Deno.serve({ signal })` has no equivalent: on abort → `server.stop()`; the returned
    `finished` promise resolves when stop completes (main.ts drains the hub after).
  - `error` option logs and returns the same 500 body.
  - `idleTimeout`: Deno took seconds per-upgrade from `transport.idle_timeout_ms`
    (default 300000ms); Bun takes seconds at server level, **max 255** — clamp and note.
- WebSocket (`src/core/ws.ts`): `Deno.upgradeWebSocket` → `server.upgrade(req, { data })`
  from the Hono handler (`c.env.server`), with `websocket: { open, close, error }`
  handlers configured once at serve time. Per-connection state (`userId`, `intents`,
  `cleanup`) moves to `ws.data`.
  - **`hub.ts` is untouched**: the hub stores `Connection` objects, and `WsConnection`
    only needs `{ send(data: string): void }` — Bun's `ServerWebSocket` satisfies it.
- `serveStatic`: `@hono/hono/deno` → `@hono/hono/bun` (`src/core/bootstrap/endpoints.ts`).
- Rate limiter (`src/core/rate-limiter.ts`): `c.env.remoteAddr.hostname` (Deno) →
  `c.env.server.requestIP(c.req.raw)?.address` (Bun); trust-proxy header logic unchanged.

## OpenTelemetry: deferred behind a loud no-op stub

The Deno integration leaned on the runtime: Deno supplied the global tracer
provider (`OTEL_DENO=true`) and auto-instrumented `Deno.serve`, `fetch`, and
`console.*`. Bun supplies none of that, so porting the Deno *shape* would fit
poorly. Rather than bet on a Bun OTel backend now, OTel is deferred.

- `src/core/tracing.ts` is a **no-op stub** that keeps the exact call-site API
  (`withSpan`, `trace.getActiveSpan()`, `SpanStatusCode`, `recordDuration`, the
  hub meter counters, `meter`, `context`, `propagation`). Consumers are
  unchanged — 6 files, ~10 sites:
  - `src/core/hub.ts` — 2× `withSpan` (`hub.broadcast`, `hub.direct`), 3 metrics
  - `src/core/auth.ts` — 2× `withSpan` (`auth.createToken`, `auth.getUser`)
  - `src/core/crypto.ts` — 1× `withSpan` (`auth.deriveKey`)
  - `src/core/bootstrap/middlewares.ts`, `.../routing.ts` — `trace.getActiveSpan()`
    (these augmented Deno's auto-created server span; already inert under Bun —
    the future seam for a request-span middleware)
- **Loud mode:** `BLENNY_TELEMETRY_STRICT=1` makes every instrumentation call
  throw `TelemetryNotConfiguredError` (fail-fast inventory of what would be
  traced). Default is a silent no-op. Not for a running server.
- `withSpan` invokes its callback **synchronously** (matching OTel's
  `context.with`), which hub delivery depends on (`hub.write` → `conn.send`
  before the first `await`); the stub reproduces this.
- **Preserved:** the original implementation is copied verbatim to
  `docs/telemetry.deno.ts.bak` (outside the build). `docs/telemetry.md` remains
  the Deno-era spec (what was instrumented and why) — the blueprint for the
  eventual Bun backend.
- The 5 `tests/otel-*_test.ts` files and the `@opentelemetry/*` deps were
  removed with the feature.
- Optional future work: a Bun-shaped interface — request spans (Hono middleware),
  outbound `fetch` spans, and discrete events — rather than replicating Deno's
  auto-instrumentation.

## Tests

- `Deno.test` → `import { test } from "bun:test"`. Bun forbids nested `test()`, so
  `t.step(name, fn)` → a global `step(name, fn)` helper (`tests/preload.ts`, typed in
  `tests/globals.d.ts`, registered via `bunfig.toml`'s `[test] preload`).
- The two options-form tests (`surreal-store_test.ts`, `db-live_test.ts`) →
  `test(name, fn, { skip: ... })` (they only use `name`/`ignore`; no `sanitizeOps` in use).
- `@std/assert` stays (JSR-in-Bun) — assertion lines unchanged.
- `tests/kv-store_test.ts` → rewritten as `tests/sqlite-user-store_test.ts` against
  `openSqliteStore(":memory:")`; behavioral steps carry over verbatim.
- `Deno.makeTempDirSync`/`removeSync` (`fs-blob-store_test.ts`) → `node:fs` sync APIs.
- Strip `// deno-lint-ignore` comments.
- Verify `bun test` discovers the `*_test.ts` naming convention; if not, configure or rename.

## Tooling

- `tools/generate-manifest.ts`: `Deno.args`/`cwd`/`readDir`/`stat`/`writeTextFile` →
  node/bun equivalents; still required before `bun build --compile` (compiled binaries
  cannot scan the modules directory — manifest is statically imported). Currently emits 7
  modules: `dashboard, index, demo/transport, demo/tasks, auth/password-change,
  auth/user-admin, auth/form-auth-surreal`.
- `tools/init.ts`: scaffolds a **Bun** project (`package.json`, `tsconfig.json`,
  `bunfig.toml`) instead of `deno.json`.
- `docs/examples/system-dashboard`: `Deno.systemMemoryInfo`/`loadavg`/`hostname` → `node:os`.
- CI: `oven-sh/setup-bun@v2`, cache `~/.bun/install/cache`, `bun install --frozen-lockfile`,
  `bun run check`, `bun test`.
- `.vscode/settings.json`: remove `deno.*` settings.
- README / agents.md / docs: `deno task X` → `bun run X` command updates.
- Bun auto-loads `.env` files (Deno did not). No `.env` ships with the repo; noted for
  scaffolds — config precedence (CLI > env > file > default) is unchanged.

## Post-port fixes discovered during end-to-end verification

- **Module init order must come from capabilities, not filesystem order.** `Deno.readDir`
  and Node's `readdir` return entries in different orders. `dashboard` needed the store set
  by the auth module's `initialize()` but declared no `requires`, so it only worked by
  directory-order luck under Deno. Fixed by adding `requires: ["auth"]` to
  `src/modules/dashboard.tsx` (the same pattern `password-change`/`user-admin` already use),
  so `sortByDependencies` orders it after the auth provider regardless of scan order.
- **`bun run check` generates the manifest first.** `src/modules/manifest.ts` is generated
  and gitignored, but `module-loader.ts` statically imports `../modules/manifest.ts`, so
  `tsc` errors (`TS2307`) without it. `check` is therefore
  `bun run generate-manifest && tsc --noEmit` (the original Deno project had no typecheck
  task at all).
- **Default `database.type=surreal` blocks boot without a running SurrealDB** — the
  `surrealdb` SDK's `connect()` hangs (never rejects) against a dead server, so
  `setupDatabase()` never returns and `Bun.serve()` is never reached. This is pre-existing
  app behavior (identical under Deno), not a port regression. Boot requires either a
  reachable SurrealDB or a non-surreal driver.

## Verification checklist

- [x] `bun run check` is clean (runs `generate-manifest` first)
- [x] `bun test` passes with the same set of tests as `deno test` (74 pass, 2 skip)
- [x] `bun run dev` serves `/health`, static files, SSE, and WebSocket upgrades
- [x] SIGINT drains in-flight requests, stops modules, exits cleanly
- [x] `bun run compile` produces a working binary (manifest generated first)
- [x] `createUser` throws `"Username is already taken"` on duplicate
- [x] `findAll` returns users with `avatarKey` **absent** (not null) when unset
- [x] `fs-blob-store_test.ts` passes, including the 404 path

## Explicit non-goals

- No `store.ts` refactor; no KV wrapper packages; no unstorage/db0/quickv.
- No error-message string changes; no config precedence changes.
- No module-loader "improvements" — port faithfully first.
- No otel-bun / OTLP exporter wiring — OTel is deferred behind a loud no-op stub.
