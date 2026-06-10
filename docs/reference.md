# Documentation Reference

Inventory of docs against the current codebase. Categories help triage what
needs attention and what's healthy.

## Document inventory

| Document | Status | Notes |
|---|---|---|
| `architecture.md` | ✅ Current | Core design, transport, layout, error handling |
| `auth-storage.md` | ✅ Current | User store interface, implementations |
| `csrf.md` | ✅ Current | CSRF protection patterns |
| `database.md` | ✅ Current | Database drivers, query patterns |
| `module-directories.md` | ✅ Current | Multi-file module convention |
| `modules.md` | ✅ Current | Recently updated for NavLink, effectiveRoles |
| `production-readiness.md` | ✅ Current | Deployment checklist |
| `telemetry.md` | ✅ Current | OpenTelemetry integration |
| `versioning.md` | ✅ Current | Version scheme and policy |
| `visibility-policy.md` | ⚠️ Superseded | Header points to current NavLink approach; body is historical (references deleted `component-catalog.ts`) |
| `todo-kv-storage.md` | ✅ Done | KV store implementation exists in `src/core/kv-store.ts`. "Remaining" section notes handler-level tests not yet written. |
| `todo-pubsub-logging.md` | ✅ Done | Log migration complete. One outlier: `src/core/database.ts` still uses `console.error` for startup failure instead of `publish("log", ...)`. |
| `todo-task-supervisor.md` | 📋 Planned | Three items not yet implemented: OTel instrumentation, `GET /system/tasks` endpoint, pause/resume for individual tasks. |
| `tutorial-system-dashboard.md` | ✅ Current | Walkthrough for building a system-dashboard module |
| `examples/` | ✅ Current | Example module source files |

## Stale references

- `visibility-policy.md` body — code sketches reference the deleted `component-catalog.ts`. The superseded header directs readers to `src/core/nav.tsx` and `docs/modules.md`, so the body is harmless historical context but could mislead someone scanning.
- `todo-kv-storage.md` "Remaining" — acknowledges `POST /auth/avatar` and `GET /avatars/:userId` handler tests aren't written. Accurate as-is, no change needed.

## Unverified claims

None found after audit of `modules.md` AppState reference and Pattern Summary
table against `src/core/app-state.ts`. Both match.

## Resolved concerns

From the visibility-policy review conversation:

| Concern | Resolution |
|---|---|
| Two auth implementations compete | They're database drivers (`form-auth-kv` / `surreal`), selected by config. Not competing auth modules. |
| Import map alias leaks internals | `@blenny/core/` → `./src/core/` is standard Deno practice. No better alternative. |
| Todo docs describe unimplemented features | 2 of 3 are done; 1 (`todo-task-supervisor.md`) is a legitimate forward-looking plan. |

## Known coverage gaps

| Area | What's missing | Priority |
|---|---|---|
| JSX component tests | `NavLink`, `DashboardPage`, `ProfilePage` have no render tests. `hasRole()` is tested in `tests/nav_test.ts` but the component isn't. | Medium |
| Avatar handler tests | `todo-kv-storage.md` calls out `POST /auth/avatar` and `GET /avatars/:userId` handler-level tests as unwritten. | Low |
| `todo-task-supervisor.md` | OTel instrumentation, status endpoint, pause/resume — all planned, none started. | Low |
| `database.ts` console.error | One remaining `console.error` in `src/core/database.ts` that wasn't migrated to `publish("log", ...)`. Trivial fix. | Low |
