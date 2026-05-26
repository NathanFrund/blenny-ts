# Writing Modules

Modules are the fundamental unit of application logic in Blenny-ts. Drop a `.ts` or `.tsx` file into `src/modules/` with a default export matching `BlennyModule` and it's auto-discovered at startup.

## Anatomy of a Module

```ts
import type { BlennyModule } from "../types.ts";

const myModule: BlennyModule = {
  name: "my-module",
  routes: [],
  subscriptions: [],
  layout: undefined,          // optional, module-level default layout

  initialize(state) { /* called once at boot */ },
  start()        { /* called after all modules init */ },
  stop()         { /* called on shutdown */ },
};

export default myModule;
```

## Routes

Define HTTP routes with method, path, and handler:

```ts
routes: [
  { method: "GET",  path: "/hello",          handler: handleHello },
  { method: "POST", path: "/hello/create",   handler: handleCreate, auth: true },
  { method: "GET",  path: "/admin",          handler: handleAdmin, auth: "admin" },
]
```

| Field | Type | Purpose |
|-------|------|---------|
| `method` | `"GET" \| "POST" \| "PUT" \| "DELETE"` | HTTP method |
| `path` | `string` | URL path |
| `handler` | `(c: Context) => Response \| Promise<Response>` | Route handler |
| `auth` | `boolean \| string` | Requires auth; `true` = any user, `"role"` = specific role |

### Rendering with Conduit

```ts
import type { Conduit } from "../core/conduit.ts";

let conduit: Conduit;

// In initialize:
conduit = state.conduit;

// In a route handler:
function handlePage(c: Context): Response | Promise<Response> {
  return conduit.respond(c, <div>Hello World</div>);
}
```

Conduit automatically detects HTMX requests — returns a fragment on swaps, wraps in a layout on full page loads.

### Custom Layouts

Create a layout component:

```tsx
// src/core/layouts/datastar.tsx
import type { FC, Child } from "@hono/hono/jsx";

export const DatastarLayout: FC<{ children: Child }> = (props) => (
  <html>
    <head>
      <title>My App</title>
      <script src="https://cdn.jsdelivr.net/npm/starfederation-datastar/umd/datastar.js">
      </script>
    </head>
    <body>{props.children}</body>
  </html>
);
```

Use it per-response:

```ts
import { DatastarLayout } from "../core/layouts/datastar.tsx";

conduit.respond(c, <ChatPage />, { layout: DatastarLayout });
```

## Subscriptions

React to typed events from the framework or other modules:

```ts
subscriptions: [
  { topic: "auth:signin", handler: (payload) => {
    console.log(`User ${payload.userId} signed in`);
  }},
  { topic: "spatial:tick", handler: (payload) => {
    // payload.cycle, payload.activeAgents
  }},
]
```

### Available Event Topics

| Topic | Payload | Emitted By |
|-------|---------|------------|
| `auth:signin` | `{ userId, timestamp }` | Auth module |
| `auth:signout` | `{ userId, timestamp }` | Auth module |
| `spatial:tick` | `{ cycle, activeAgents }` | Simulation module |
| `platform:ready` | `{ timestamp }` | `main.ts` on listen |

### Publishing Events

```ts
import { publish } from "../core/hub.ts";

publish("spatial:tick", { cycle: 42, activeAgents: 5 });
```

## Broadcasting to Clients

Access the hub through `state.hub` during initialization:

```ts
let hub: TransportHub;

// In initialize:
hub = state.hub;

// Somewhere in a handler or subscription:
hub.patchElements("<div>Updated!</div>", { intent: "ui" });
hub.mergeSignals({ score: 100 }, { userId: "abc123" });
hub.executeScript("console.log('hello')", { intent: "notification" });
```

### Broadcast Options

| Option | Purpose |
|--------|---------|
| `intent` | Filter to connections matching this intent (`"ui"`, `"data"`, `"command"`, `"notification"`) |
| `userId` | Direct message to a specific user's connections |

## Lifecycle Hooks

### initialize(state)

Called once at boot, after all modules are loaded but before routes are registered. Use for:

- Storing framework references (conduit, hub, config)
- Setting up auth (`state.auth = ...`)
- Seeding data
- One-time setup

```ts
initialize(state: AppState) {
  // Store references
  conduit = state.conduit;
  hub = state.hub;
  config = state.config;

  // Auth setup
  state.auth = {
    config: { jwtSecret: config.jwtSecret, ... },
    middleware: createAuthMiddleware(config),
    requireUser: requireUser(),
    requireRole: requireRole,
  };

  // Optional DB access
  const db = state.db; // Surreal instance or undefined
}
```

### start()

Called after all modules are initialized and subscribed. Use for:

- Starting background intervals
- Opening persistent connections
- Beginning polling loops

### stop()

Called on graceful shutdown, in reverse initialization order. Use for:

- Clearing intervals
- Closing connections
- Flushing state

```ts
start() {
  const id = setInterval(() => {
    hub.patchElements(`<div>tick ${Date.now()}</div>`);
  }, 1000);
  // Store id for cleanup in stop
}

stop() {
  clearInterval(id);
}
```

## Full Example

```ts
import type { FC } from "@hono/hono/jsx";
import type { Context } from "@hono/hono";
import type { Conduit } from "../core/conduit.ts";
import type { TransportHub } from "../core/hub.ts";
import { publish } from "../core/hub.ts";
import type { AppState } from "../core/app-state.ts";
import type { BlennyModule } from "../types.ts";

let conduit: Conduit;
let hub: TransportHub;

const HelloPage: FC = () => (
  <div>
    <h1>Hello, World</h1>
    <p>Served by Blenny-ts</p>
  </div>
);

function handleHello(c: Context): Response | Promise<Response> {
  return conduit.respond(c, <HelloPage />);
}

const helloModule: BlennyModule = {
  name: "hello",
  routes: [
    { method: "GET", path: "/", handler: handleHello },
  ],

  initialize(state: AppState) {
    conduit = state.conduit;
    hub = state.hub;
  },
};

export default helloModule;
```

## Testing

Test files live in `tests/` and mirror the module structure. Use Hono's `app.request()` for HTTP-level tests:

```ts
import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import myModule from "../src/modules/my-module.ts";
import { BlennyConfig } from "../src/core/config.ts";
import { TransportHub } from "../src/core/hub.ts";
import { Conduit } from "../src/core/conduit.ts";
import type { AppState } from "../src/core/app-state.ts";

async function buildApp(): Promise<Hono> {
  const config = new BlennyConfig();
  const hub = new TransportHub();
  const conduit = new Conduit();
  const state: AppState = { hub, conduit, config };
  const app = new Hono();

  await myModule.initialize?.(state);

  for (const route of myModule.routes) {
    app.on(route.method as "GET", route.path, route.handler as any);
  }

  return app;
}

Deno.test("GET /", async () => {
  const app = await buildApp();
  const res = await app.request("http://localhost/");
  assertEquals(res.status, 200);
});
```

Run with:

```bash
deno test --allow-read --allow-env
```
