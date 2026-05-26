# blenny-ts — Architecture & Implementation Roadmap

## Project Identity

A Deno/TypeScript port of the Blenny philosophy (Pharo Smalltalk → Rust → Clojure → TS). A hypermedia-driven web framework where modules self-assemble, real-time is default, and deployment is a single binary.

## Core Design Principles

1. **Self-assembling modules** — drop a `.ts` file into `src/modules/`, it auto-registers routes and subscriptions
2. **Real-time by default** — SSE is a first-class framework primitive, not an afterthought
3. **Pluggable transport encoders** — modules write action-based code, the framework serializes (Standard SSE or Datastar)
4. **Connection intents** — client-side deduplication when multiple connections are open
5. **Encoder-agnostic hub API** — module code never changes when swapping wire formats
6. **Single binary** — `deno compile` produces a self-contained executable
7. **Zero ceremony** — `main.ts` is infrastructure only; all active logic lives in modules

## What's Built

| Component | Status |
|---|---|
| Module loader (filesystem scan + dynamic import) | ✅ |
| Typed event bus (`publish`/`subscribe` keyed on `BlennyEvents`) | ✅ |
| Hono server with route registration | ✅ |
| `/sse` endpoint (basic SSE stream) | ✅ |
| `platform:ready` lifecycle event | ✅ |
| Zero `any` types (strict `no-explicit-any` compliance) | ✅ |
| TransportHub + Datastar/Standard encoders | ✅ |
| Module lifecycle hooks (initialize/start/stop) | ✅ |
| Connection intents (hub-level intent filtering) | ✅ |
| JSX Conduit (HTMX-aware fragment/layout rendering) | ✅ |
| Auth module + JWT middleware (pluggable strategies) | ✅ |
| Per-user messaging (SSE connections bound to userId) | ✅ |

## Architectural Decisions

### Orthogonal Layers

Three independent concerns that never cross-contaminate:

| Layer | Concern | Stable interface |
|---|---|---|
| **Actions** | What the module wants to do | `patchElements`, `mergeSignals`, `executeScript` |
| **Intents** | Which connections should receive it | `"ui"`, `"command"`, `"notification"`, `"data"` |
| **Encoders** | How it's serialized on the wire | `encode()`, `contentType` |

### TransportHub (central nervous system)

Modules never write to SSE streams directly. Everything goes through the `TransportHub`:

```
module calls: hub.patchElements("<div>hi</div>", { intent: "ui" })
                    │
                    ▼
              TransportHub
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
   Connection A  Connection B  Connection C
   SSE?intent=ui  WS?intent=cmd  SSE?intent=all
   ✓ delivers     ✗ skips        ✓ delivers
         │                       │
         ▼                       ▼
   DatastarEncoder          StandardEncoder
```

### Connection Model (UUID-per-tab)

Each connection gets a unique UUID. This enables:
- **Per-tab messaging** — direct messages reach the right browser tab
- **Auto-cleanup** — dropped connections are removed from all maps via `AbortSignal`
- **Deduplication** — intents prevent a user with 3 connections from receiving 3 copies

Internal data structures:

```
global writers:    Set<Writer>                                 // broadcast to all
topic subs:        Map<string, Set<Writer>>                    // topic pub/sub
user writers:      Map<string, Map<uuid, Writer>>              // per-user per-tab
```

### Encoder Strategy

| Encoder | Wire format | When to use |
|---|---|---|
| `DatastarEncoder` | Named SSE events (`datastar-patch-elements`, `datastar-merge-signals`, `datastar-execute-script`) | Default. Rich hypermedia, client-side intent filtering via SDK |
| `StandardEncoder` | Plain SSE (`event: message\ndata: {"action":"patchElements",...}`) | Browser-native EventSource, HTMX, minimal JS |

Switching encoders is a one-line config change. Module code never changes.

### Auth Strategy

An auth module is just a `BlennyModule` that additionally sets `state.auth` (an `AuthBundle`) during `initialize()`. The module owns the UI (form, OAuth, QR), credential validation, and token issuance. The framework reads `state.auth` after initialization and:

- Applies `auth.middleware` globally (reads JWT cookie/query param, sets `c.get("user")`)
- Wraps handlers with `requireUser`/`requireRole` guards when `route.auth` is set
- Passes `userId` to SSE connections via `?token=` query param or cookie

To swap auth strategies, drop in a different module. No framework changes needed.

### Template Strategy

**JSX via Hono's precompiled JSX** — no separate template language. Modules export `.tsx` files that are type-checked, authored alongside their handlers, and rendered inline. The `deno.json` already configures `"jsx": "precompile"` with `@hono/hono/jsx` as the import source.

### Datastar: Default, First-Class

- Shipped enabled by default
- Not an optional plugin — it's the primary encoder
- Standard encoder ships alongside for compatibility
- Both encoders implement the same `TransportEncoder` interface

## Implementation Roadmap

### Phase 1: TransportHub + Encoder Core
- `src/core/envelope.ts` — `ServerMessage`, `Intent` types
- `src/core/transport-encoder.ts` — `TransportEncoder` interface
- `src/core/encoders/standard-encoder.ts` — Standard SSE wire format
- `src/core/encoders/datastar-encoder.ts` — Datastar wire format
- `src/core/hub.ts` — `TransportHub` (broadcast, direct, topic pub/sub, connection registry)
- Update `/sse` route to use hub + encoder

### Phase 2: Module Lifecycle + AppState
- `src/core/app-state.ts` — service bundle (hub, encoder, config)
- Extend `BlennyModule` with `initialize(AppState)`, `start()`, `stop()`
- Move tick loops from `main.ts` into module `start()` hooks
- Add graceful shutdown (SIGINT/SIGTERM → `stop()` in reverse order)

### Phase 3: Connection Intents
- Query parameter parsing (`?intent=ui,notification`)
- Hub-level filtering per connection
- Deduplication across SSE + WebSocket

### Phase 4: JSX Conduit
- `Conduit.render(template, props, request)` — auto-detects HTMX, returns fragment or full page
- Extension stripping, template ownership

### Phase 5: Auth + Per-User Messaging
- `src/core/auth.ts` — JWT primitives, cookie helpers, middleware factories
- `src/modules/form-auth.tsx` — reference auth module (hardcoded admin/admin)
- Route-level `auth` flag on `Route` type (`true` or role string)
- Framework wires `requireUser`/`requireRole` guards based on `route.auth`
- `/sse` reads JWT from cookie or `?token=`, binds connection to `userId`
- Auth strategies are swappable by replacing the auth module

## Dependency Stack

| Dependency | Purpose |
|---|---|
| `@hono/hono` | HTTP router, JSX rendering, middleware |
| `@std/path` | Filesystem path resolution (file URL → system path) |
| *(stdlib only)* | Deno's built-in crypto (`crypto.randomUUID()`), streams, etc. |

Zero external dependencies beyond Hono and stdlib. This is intentional — Deno's standard library and runtime provide everything else (file system, crypto, streams, HTTP, signals).

## Open Questions for Team Discussion

1. **WebSocket sidecar** — should this ship in MVP or later? The Rust/Clojure versions make it opt-in via config flag. SSE alone covers the real-time use case for most applications.
2. ~~Auth module — ship a dev auth module (hardcoded admin/password) in core, or leave auth entirely to user modules?~~ **Resolved: shipped `form-auth.tsx` as reference implementation; swappable strategy pattern.**
3. ~~JSX Conduit scope — minimal helper (detect HTMX, render fragment) or full template engine with named templates, extension stripping, and hot-reload from disk?~~ **Resolved: minimal helper.**
4. **Single-binary compilation** — `deno compile` is in the task file but untested with FFI/`--allow-ffi`. Should we validate this early or defer to late-stage?

---

*Based on patterns from blenny-rs (Rust), blenny-clj (Clojure), and the original blenny (Pharo Smalltalk).*
