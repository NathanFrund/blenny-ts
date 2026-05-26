# Architecture

## Overview

Blenny-ts is a real-time web framework that provides infrastructure (transport, rendering, config, auth) but never owns the application logic. All behavior lives in modules that hook into the lifecycle.

```
                 ┌─────────────┐
                 │   main.ts    │
                 │  (server +   │
                 │   lifecycle) │
                 └──────┬──────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼────┐   ┌─────▼──────┐   ┌────▼────┐
   │ Config  │   │  Modules   │   │  Hub    │
   │Composite│   │ (discovered│   │ SSE/WS  │
   │Provider │   │  at boot)  │   │ Manager │
   └─────────┘   └─────┬──────┘   └─────────┘
                       │
              ┌────────┴────────┐
              │                 │
         ┌────▼────┐      ┌────▼────┐
         │ Conduit │      │  Auth   │
         │ (JSX +  │      │  Bundle │
         │ Layout) │      │ (JWT +  │
         └─────────┘      │ Cookies)│
                          └─────────┘
```

## Module Lifecycle

Modules are loaded from `src/modules/` at startup and progress through five phases:

```
   Load ──→ Filter ──→ Initialize ──→ Subscribe ──→ Start
                                             │
                                             │  (server runs)
                                             │
                                        Stop (on shutdown)
```

| Phase | Hook | Purpose |
|-------|------|---------|
| **Load** | — | `module-loader.ts` scans for default exports matching `BlennyModule` |
| **Filter** | `enabled` | Skip modules with `enabled: false` |
| **Initialize** | `initialize(state)` | Inject dependencies (hub, conduit, config), set up auth, seed data |
| **Subscribe** | `subscriptions` | Register typed event handlers on the bus |
| **Start** | `start()` | Begin background tasks (timers, polling loops) |
| **Stop** | `stop()` | Tear down, release resources |

## Config System

Composite provider with four sources in priority order:

| Priority | Source | Format |
|----------|--------|--------|
| 1 (highest) | CLI args | `--server.port=8080` or `--server.port 8080` |
| 2 | Env vars | `BLENNY_SERVER_PORT=8080` (dots → underscores) |
| 3 | `blenny.json` | Flat dotted-key JSON in working directory |
| 4 (lowest) | Embedded defaults | Hardcoded in `src/core/config.ts` |

### Convenience Getters

```ts
config.port                // Number
config.bindAddress         // String
config.jwtSecret           // String
config.sessionDurationHours // Number
config.cookieName          // String
config.devMode             // Boolean
config.surrealUrl          // String
config.surrealNs           // String
config.surrealDb           // String
config.surrealUser         // String
config.surrealPass         // String
config.at("any.dotted.key") // Raw access
```

### Embedded Defaults

| Key | Default |
|-----|---------|
| `server.port` | `3000` |
| `server.bind_address` | `0.0.0.0` |
| `auth.jwt_secret` | `CHANGE-ME-EMBEDDED-DEFAULT` |
| `auth.session_duration_hours` | `720` |
| `auth.cookie_name` | `blenny_session` |
| `dev_mode` | `true` |
| `surreal.url` | `ws://127.0.0.1:8000/rpc` |
| `surreal.ns` | `blenny` |
| `surreal.db` | `blenny` |
| `surreal.user` | `root` |
| `surreal.pass` | `root` |

## Auth System

Auth is entirely module-driven. A module sets `state.auth` during `initialize()`:

```ts
state.auth = {
  config,                                   // jwtSecret, cookieName, sessionExpiry
  middleware: createAuthMiddleware(config),  // Sets c.get("user")
  requireUser: requireUser(),               // Redirects if no user
  requireRole: requireRole,                 // Factory for role checks
};
```

Once set, `main.ts` applies the middleware globally and guards routes marked `auth: true` or `auth: "role"`.

The reference `form-auth.tsx` module provides in-memory user storage with SHA-256 password hashing, registration, and JWT cookie sessions.

## Transport System

### TransportHub

Central connection manager. Tracks connections by ID and by user ID.

```ts
hub.registerConnection(conn)       // Returns cleanup function
hub.patchElements(html, opts?)     // Broadcast HTML patches
hub.mergeSignals(data, opts?)      // Broadcast signal merges
hub.executeScript(script, opts?)   // Broadcast script execution
```

### Connection model

Each connection implements the `Connection` interface:

```ts
interface Connection {
  id: string;
  userId?: string;
  intents?: Set<Intent>;
  send(msg: ServerMessage): void;
}
```

Two implementations:

| Connection | Protocol | Payload |
|------------|----------|---------|
| `SseConnection` | Server-Sent Events via Datastar SDK | Proper SSE framing (`datastar-patch-elements`, etc.) |
| `WsConnection` | WebSocket | Bare HTML/JSON/script strings |

### Intent Routing

Connections declare intent filters at registration (`?intent=ui,data`). The hub skips delivery when a message's intent doesn't match the connection's filter.

### Typed Event Bus

`publish()` / `subscribe()` for strictly typed events. Topics are fully decoupled — only `platform:ready` is emitted by the framework itself; the rest fire only when the emitting module is loaded.

```ts
publish("auth:signin", { userId: "abc", timestamp: Date.now() });
subscribe("auth:signin", (payload) => { /* payload.userId */ });
```

## Layout System

The `Conduit` class provides HTMX-aware JSX rendering:

```
respond(c, <MyPage />)
         │
    ┌────┴────┐
    │ HTMX?   │
    └────┬────┘
     yes │   no
         ▼      ▼
   <MyPage />    Layout({ children: <MyPage /> })
```

Modules can override the layout per-response:

```ts
conduit.respond(c, <MyPage />, { layout: MyCustomLayout });
```

And declare a module-level default on `BlennyModule.layout` for documentation/organization.

## Database

Optional SurrealDB integration via `state.db`:

```ts
// main.ts connects automatically if config.surrealUrl is set
const result = await state.db?.query("SELECT * FROM person");
```

Helper utilities:

```ts
requireDb(state.db)   // Throws DbError if undefined
await withDb(state.db, async (db) => { ... }, fallback)  // Graceful fallback
```

## Graceful Shutdown

On SIGINT/SIGTERM:

1. Server stops accepting connections
2. Modules stop in reverse initialization order
3. Database connection closes
