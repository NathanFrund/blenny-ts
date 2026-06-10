# Writing Modules

Modules are the fundamental unit of application logic in Blenny-ts. Drop a `.ts`
or `.tsx` file into `src/modules/` with a default export matching `BlennyModule`
and it's auto-discovered at startup.

## Anatomy of a Module

```ts
import type { BlennyModule } from "../types.ts";

const myModule: BlennyModule = {
  name: "my-module",
  routes: [],
  subscriptions: [],
  layout: undefined, // optional, module-level default layout

  initialize(state) {/* called once at boot */},
  start() {/* called after all modules init */},
  stop() {/* called on shutdown */},
};

export default myModule;
```

| Field           | Type             | Default | Purpose                                                 |
| --------------- | ---------------- | ------- | ------------------------------------------------------- |
| `name`          | `string`         | —       | Unique module name                                      |
| `routes`        | `Route[]`        | `[]`    | HTTP routes the module provides                         |
| `layout`        | `FC`             | —       | Default layout for Conduit rendering                    |
| `subscriptions` | `Subscription[]` | —       | Typed event bus subscriptions                           |
| `capabilities`  | `string[]`       | —       | Framework features this module provides (e.g. `"auth"`) |

## Routes

Define HTTP routes with method, path, and handler:

```ts
routes: [
  { method: "GET", path: "/hello", handler: handleHello },
  { method: "POST", path: "/hello/create", handler: handleCreate, auth: true },
  { method: "GET", path: "/admin", handler: handleAdmin, auth: "admin" },
];
```

| Field     | Type                                            | Purpose                                                    |
| --------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `method`  | `"GET" \| "POST" \| "PUT" \| "DELETE"`          | HTTP method                                                |
| `path`    | `string`                                        | URL path                                                   |
| `handler` | `(c: Context) => Response \| Promise<Response>` | Route handler                                              |
| `auth`    | `boolean \| string`                             | Requires auth; `true` = any user, `"role"` = specific role |

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

Conduit automatically detects HTMX requests — returns a fragment on swaps, wraps
in a layout on full page loads.

### Custom Layouts

Create a layout component:

```tsx
// src/core/layouts/datastar.tsx
import type { Child, FC } from "@hono/hono/jsx";

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
  {
    topic: "auth:signin",
    handler: (payload) => {
      console.log(`User ${payload.userId} signed in`);
    },
  },
];
```

### Available Event Topics

Only `platform:ready` is guaranteed by the framework. All other topics fire only
when the emitting module is loaded. Each topic is fully typed — see
[Types & TypeScript Patterns](#types--typescript-patterns) for how modules
declare event payloads.

| Topic            | Payload                 | Emitted By                |
| ---------------- | ----------------------- | ------------------------- |
| `auth:signin`    | `{ userId, timestamp }` | Auth module (`form-auth`) |
| `auth:signout`   | `{ userId, timestamp }` | Auth module (`form-auth`) |
| `platform:ready` | `{ timestamp }`         | Framework (`main.ts`)     |

### Publishing Events

```ts
import { publish } from "../core/hub.ts";

await publish("auth:signin", { userId: "abc", timestamp: Date.now() });
```

The typed event system is fully decoupled — any module can publish any topic,
and subscribers react only if the publishing module is present at runtime.

## Broadcasting to Clients

Push HTML or data to connected clients from **anywhere** — route handlers,
subscriptions, background loops — with zero wiring via `BlennyPublisher`:

```ts
import { BlennyPublisher } from "../core/publisher.ts";

// Broadcast to every connected client
BlennyPublisher.broadcastHtml('<div id="status">Done</div>');

// Send to a specific user (all their SSE and WS connections)
BlennyPublisher.directHtml("<div>Private</div>", userId);

// Push JSON data (parsed internally to signals)
BlennyPublisher.broadcastData('{"score":100}');
BlennyPublisher.directData('{"msg":"secret"}', userId);
```

The publisher is initialized automatically at boot — modules never need to store
or wire it.

### Example: Real-time task list

This module adds a task via POST and pushes the updated list to only the
submitting user's connections:

```ts
import type { Context } from "@hono/hono";
import { BlennyPublisher } from "../core/publisher.ts";
import type { UserInfo } from "../core/auth.ts";
import type { BlennyModule } from "../types.ts";

const tasks: string[] = [];

function renderTaskList(): string {
  return `<ul id="task-list" hx-swap-oob="innerHTML">${
    tasks.map((t) => `<li>${t}</li>`).join("")
  }</ul>`;
}

async function handleAddTask(c: Context): Promise<Response> {
  const user = c.get("user") as UserInfo | undefined;
  if (!user) return c.redirect("/auth/signin");

  const body = await c.req.parseBody();
  tasks.push(body.task as string);

  // Push the updated list to just this user's connections — no wiring needed
  BlennyPublisher.directHtml(renderTaskList(), user.id);

  return c.redirect("/tasks");
}

const tasksModule: BlennyModule = {
  name: "tasks",
  routes: [
    { method: "POST", path: "/tasks/add", handler: handleAddTask, auth: true },
  ],
};

export default tasksModule;
```

Note: the module has no `initialize()` hook and stores no references —
`BlennyPublisher` is ready globally.

The client's SSE connection receives a Datastar `datastar-patch-elements` event
and swaps the `<ul id="task-list">` in-place. The `userId` routing ensures only
the submitting user sees the update across all their open tabs.

### Low-level Hub

For cases that need intents, the `TransportHub` is still available directly in
modules that store a reference during `initialize()`:

```ts
// Push HTML with intent filtering
hub.patchElements('<div id="status">Done</div>', { intent: "ui" });

// Merge signals with both intent and user targeting
hub.mergeSignals({ score: 100 }, { intent: "data", userId });
hub.executeScript("alert('Time up!')", { intent: "notification" });
```

The `BlennyPublisher` methods (`broadcastHtml`, `directHtml`, `broadcastData`,
`directData`) are thin wrappers around `hub.patchElements` and
`hub.mergeSignals`. Choose the publisher for zero-ceremony pushes; use the hub
directly when you need intent-level control.

## Lifecycle Hooks

### initialize(state)

Called once at boot, after all modules are loaded but before routes are
registered. Use for:

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
import { BlennyPublisher } from "../core/publisher.ts";

let intervalId: number;

start() {
  intervalId = setInterval(() => {
    BlennyPublisher.broadcastHtml(`<div>tick ${Date.now()}</div>`);
  }, 1000);
}

stop() {
  clearInterval(intervalId);
}
```

## Component Registry

Modules can register components — nav items, widgets, action buttons, panels —
that appear in the dashboard, profile page, or any other page that renders them.
Components are filtered by the user's roles at render time.

### UIComponent

| Field     | Type                                          | Default | Purpose                                                        |
| --------- | --------------------------------------------- | ------- | -------------------------------------------------------------- |
| `id`      | `string`                                      | —       | Unique identifier (use namespacing: `"nav.dashboard"`)         |
| `type`    | `"nav" \| "widget" \| "action" \| "panel" \| string` | — | Component category                                             |
| `label`   | `string`                                      | —       | Display text                                                   |
| `href`    | `string`                                      | —       | Link target (nav items)                                        |
| `icon`    | `string`                                      | —       | Icon name (e.g. `"lucide-layout-dashboard"`)                   |
| `group`   | `string`                                      | —       | Section grouping (`"main"`, `"account"`, `"admin"`)            |
| `order`   | `number`                                      | `100`   | Sort position within the list (lower sorts first)              |
| `meta`    | `Record<string, unknown>`                     | —       | Extra data for the specific component                          |
| `visible` | `(user?: UserInfo) => boolean`                | —       | Visibility predicate; absent → always visible                  |

### Registering from a module

Call `state.components.register()` during `initialize()`. The registry is
shared — items from any module are visible to all:

```ts
import type { AppState } from "../core/app-state.ts";
import type { BlennyModule } from "../types.ts";

const myModule: BlennyModule = {
  name: "my-module",
  routes: [
    { method: "GET", path: "/reports", handler: handleReports, auth: true },
  ],

  initialize(state: AppState) {
    state.components.register({
      id: "nav.reports",
      type: "nav",
      label: "Reports",
      href: "/reports",
      group: "main",
      order: 20,
    });
  },
};
```

### Role-gating components

Use the `hasRole` factory to restrict visibility. A module author can use any
role name — the platform does not define a fixed set:

```ts
import { hasRole } from "../core/component-registry.ts";

// Admin-only
state.components.register({
  id: "nav.admin-users",
  type: "nav",
  label: "User Administration",
  href: "/admin/users",
  group: "admin",
  order: 10,
  visible: hasRole("admin"),
});

// Visible to either admins or commanders
state.components.register({
  id: "nav.event-dashboard",
  type: "nav",
  label: "Event Dashboard",
  href: "/events/dashboard",
  group: "main",
  order: 30,
  visible: hasRole("admin", "commander"),
});
```

Omitting `visible` makes the component visible to everyone. `hasRole` supports
three sources for the user's roles, checked in order:
1. `user.roles` — explicit multi-role array (from JWT or computed)
2. `user.effectiveRoles` — contextual roles set by middleware
3. `user.role` — singular role (backward compat fallback)

### Rendering components in your own pages

Capture `state.components` during `initialize()`, then call
`.getNavItems(user)` in your handler and pass the filtered items to your page
component. The JWT payload only guarantees `id`, `role`, and `roles` — if you
need additional user data (like `displayName`), look it up from the store:

```ts
import type { AppState } from "../core/app-state.ts";
import type { UserInfo } from "../core/auth.ts";
import type { FC } from "@hono/hono/jsx";
import type { Context } from "@hono/hono";
import type { Conduit } from "../core/conduit.ts";
import type { ComponentRegistry, UIComponent } from "../core/component-registry.ts";
import type { UserStore } from "../core/store.ts";

let conduit: Conduit;
let components: ComponentRegistry;
let store: UserStore;

const MyPage: FC<{ user: UserInfo; nav: UIComponent[]; displayName: string }> = (
  { user, nav, displayName },
) => (
  <div>
    <nav>{nav.map((n) => <a href={n.href}>{n.label}</a>)}</nav>
    <h1>Welcome {displayName}</h1>
  </div>
);

async function handleMyPage(c: Context) {
  const user = c.get("user") as UserInfo;
  const full = await store.findById(user.id);
  const visible = components.getNavItems(user);
  return conduit.respond(
    c,
    <MyPage user={user} nav={visible} displayName={full?.displayName ?? user.id} />,
  );
}

const myModule: BlennyModule = {
  name: "my-module",
  routes: [
    { method: "GET", path: "/my-page", handler: handleMyPage, auth: true },
  ],

  initialize(state: AppState) {
    conduit = state.conduit;
    components = state.components;
    store = state.store!;
  },
};
```

### Contextual roles with effectiveRoles

Some applications need roles that depend on request context (e.g., "commander"
for a specific game event). These live outside the JWT and are injected by a
middleware that runs after auth:

```ts
// Application middleware (e.g., OpsCenter)
app.use("/events/*", async (c, next) => {
  const user = c.get("user") as UserInfo | undefined;
  if (!user) return next();

  const slug = c.req.param("slug");
  const isCommander = await db.query(
    "SELECT 1 FROM event_participants WHERE event_slug = $1 AND user_id = $2 AND role = 'commander'",
    slug,
    user.id,
  );

  if (isCommander) {
    c.set("user", { ...user, effectiveRoles: ["commander"] });
  }

  await next();
});
```

The middleware **must** verify the user's relationship to the context (event,
organization, etc.) — the URL slug alone is not authorization. Once
`effectiveRoles` is set, `hasRole` automatically includes those roles in its
visibility check:

| User's state                                       | `visible: hasRole("commander")` | `visible: hasRole("admin")` | `visible` omitted |
| -------------------------------------------------- | ------------------------------- | --------------------------- | ----------------- |
| `{ role: "user" }`                                 | hidden                          | hidden                      | visible           |
| `{ role: "admin" }`                                | hidden                          | visible                     | visible           |
| `{ role: "user", effectiveRoles: ["commander"] }`  | visible                         | hidden                      | visible           |
| `{ role: "admin", effectiveRoles: ["commander"] }` | visible                         | visible (via role)          | visible           |

### Low-level API

```ts
import { ComponentRegistry, hasRole } from "../core/component-registry.ts";

const components = new ComponentRegistry();

// Register items
components.register({ id: "nav.home", type: "nav", label: "Home", href: "/" });
components.register({
  id: "nav.admin",
  type: "nav",
  label: "Admin",
  href: "/admin",
  visible: hasRole("admin"),
  order: 10,
});

// Get nav items visible to a user
components.getNavItems({ role: "user" }); // [Home]
components.getNavItems({ role: "admin" }); // [Home, Admin]
components.getNavItems({ id: "1", role: "user", roles: ["admin"] }); // [Home, Admin]
components.getNavItems(undefined); // [Home]

// Check individual component visibility
components.isVisible("nav.admin", { role: "admin" }); // true

// Get other component types
components.getWidgets(user);
```

`ComponentRegistry` is a shared instance available on `AppState.components`.
Modules should use `state.components` — creating a separate instance would
produce items invisible to the rest of the application. The registry also
supports `unregister(id)`, `getById(id)`, and `clear()` for testing and
hot-reload scenarios.

## Types & TypeScript Patterns

A module relies on types from two layers: **framework types** (always available,
defined in core) and **module types** (declared by individual modules, merged at
compile time).

### Framework Types

These are defined in `src/types.ts` and `src/core/` — every module can import
them regardless of which other modules are loaded.

| Type           | Location               | Purpose                                                   |
| -------------- | ---------------------- | --------------------------------------------------------- |
| `BlennyModule` | `../types.ts`          | Shape of a module (routes, lifecycle hooks, capabilities) |
| `Route`        | `../types.ts`          | A single route entry (method, path, handler, auth)        |
| `BlennyEvents` | `../types.ts`          | Typed event bus topics (extended by modules)              |
| `AppState`          | `../core/app-state.ts`          | Everything injected into `initialize()`                   |
| `AuthBundle`        | `../core/app-state.ts`          | Auth middleware bundle set on `state.auth`                |
| `UserInfo`          | `../core/auth.ts`               | Decoded JWT payload: `{ id, role, roles?, exp }`          |
| `AuthConfig`        | `../core/auth.ts`               | Auth module configuration (secret, cookie name, etc.)     |
| `Conduit`           | `../core/conduit.ts`            | Layout-aware response renderer                            |
| `TransportHub`      | `../core/hub.ts`                | Low-level connection broadcast                            |
| `ComponentRegistry` | `../core/component-registry.ts` | Component registry (nav, widgets, panels, etc.)           |
| `UIComponent`       | `../core/component-registry.ts` | A registered component with type and visibility predicate |

#### AppState reference

The `state` object passed to `initialize()` gives you access to the entire
framework:

```ts
interface AppState {
  hub: TransportHub; // Broadcast to SSE/WS connections
  conduit: Conduit; // Render JSX with layout support
  config: BlennyConfig; // All configuration values
  supervisor: TaskSupervisor; // Background task manager
  components: ComponentRegistry; // Component registry (nav, widgets, etc.)
  auth?: AuthBundle; // Set by the auth module if loaded
  store?: UserStore; // User persistence store
  db?: DatabaseConnection; // SurrealDB instance if connected
  moduleCount?: number; // Number of loaded modules
  startTime: number; // Server start timestamp
  version: string; // Framework version
}
```

A module that provides auth sets `state.auth` during its `initialize()` — other
modules don't need to know which module did it, they just check
`if (state.auth)` at boot.

### Module Types (Declaration Merging)

Each module declares its **own event topics** using TypeScript's declaration
merging. This is the most important type pattern to understand.

Instead of a central file where you add every event in the project, each module
extends the `BlennyEvents` interface from its own source:

```ts
// src/modules/chat.tsx
import type { BlennyEvents, BlennyModule } from "../types.ts";

declare module "@blenny/types" {
  interface BlennyEvents {
    "chat:message": { roomId: string; userId: string; text: string };
    "chat:join": { roomId: string; userId: string };
  }
}
```

**How it works:**

1. Place the `declare module "@blenny/types"` block anywhere at the top level of
   your module file.
2. You must `import type { BlennyEvents } from "@blenny/types"` in the same file
   for the declaration to merge.
3. Once the file is part of the compilation, the new topics are visible
   project-wide — other modules can subscribe with full type safety without
   importing your module.
4. Do **not** edit `src/types.ts` to add module events. The interface there is
   reserved for framework core events only.

**Real example — `form-auth` declares auth events, any module subscribes without
an import:**

```ts
// form-auth — declares:
declare module "@blenny/types" {
  interface BlennyEvents {
    "auth:signin": { userId: string; timestamp: number };
    "auth:signout": { userId: string; timestamp: number };
  }
}

// Any other module — subscribes with full typing:
subscribe("auth:signin", (payload) => {
  // payload is inferred as { userId: string; timestamp: number }
  console.log(`User ${payload.userId} signed in`);
});
```

The subscriber never imports `form-auth` — the type is merged globally because
`form-auth` is loaded by the framework at boot.

### Route Auth Typing

The `auth` field on a route accepts three patterns:

| Value                     | Meaning                                                     |
| ------------------------- | ----------------------------------------------------------- |
| undefined / omitted       | Public — no authentication required                         |
| `true`                    | Any authenticated user                                      |
| `"admin"` / `"moderator"` | Specific role — checked against the user's JWT `role` field |

```ts
routes: [
  { method: "GET", path: "/public", handler: publicHandler },
  { method: "GET", path: "/profile", handler: profileHandler, auth: true },
  { method: "GET", path: "/admin", handler: adminHandler, auth: "admin" },
];
```

The auth guard is applied automatically by `main.ts` at boot — your handler
never needs to check auth status for these routes.

### Getting the User in Handlers

Routes marked `auth: true` or `auth: "admin"` are guaranteed to have a valid
user. Access it via `c.get("user")`:

```ts
import type { UserInfo } from "../core/auth.ts";

function handleProfile(c: Context): Response | Promise<Response> {
  const user = c.get("user") as UserInfo; // guaranteed by auth guard
  return c.text(`Hello ${user.id}`);
}
```

For routes without `auth`, check explicitly:

```ts
const user = c.get("user") as UserInfo | undefined;
if (!user) return c.redirect("/auth/signin");
```

### Capabilities

Modules can declare what framework capabilities they provide:

```ts
const chatModule: BlennyModule = {
  name: "chat",
  capabilities: ["realtime:chat"],
  routes: [/* ... */],
};
```

At boot, `main.ts` detects conflicting declarations — if two modules both
declare `"auth"`, the server throws a clear error and exits. This prevents
subtle bugs where a second auth module silently overrides the first.

Capabilities are strings, not a fixed enum — modules define their own. The only
convention so far is `"auth"` for modules that set `state.auth`.

To select which auth module is active, ensure only one module with the `"auth"`
capability is present in `src/modules/`. Dot-prefix a module directory (e.g.
`.form-auth-surreal/`) to disable it — the loader skips entries starting with
`.` in both scan mode and manifest mode. The filesystem is the toggle.

### Compiled Binaries & Module Manifest

When building a standalone binary with `deno task compile`, the scan-based
discovery (`Deno.readDir`) is not available — module files aren't stored
individually on disk inside the binary. Instead, `tools/generate-manifest.ts`
scans `src/modules/` and writes `src/modules/manifest.ts` with static imports:

```ts
// Auto-generated by tools/generate-manifest.ts
export { default as form_auth_kv } from "./form-auth-kv/index.ts";
export { default as dashboard } from "./dashboard.tsx";
export { default as demo } from "./demo.ts";
export { default as task_demo } from "./task-demo.ts";
export { default as index } from "./index.ts";
```

The module loader first attempts to `import("../modules/manifest.ts")`. If the
import succeeds (compiled binary), the manifest entries are loaded directly. If
it fails (dev mode, no manifest exists), it falls through to the `Deno.readDir`
scan path.

The manifest is auto-generated and `.gitignore`d. It's always regenerated as the
first step of `deno task compile` — no manual maintenance needed. To change
which modules are included, rename a directory in `src/modules/` (add/remove `.`
prefix) and recompile.

### Type-Safe Testing

When registering module routes in tests, cast the handler properly instead of
using `as any`:

```ts
import type { MiddlewareHandler } from "@hono/hono";

for (const route of myModule.routes) {
  const method = route.method as "GET" | "POST" | "PUT" | "DELETE";
  const handler = route.handler as unknown as MiddlewareHandler;
  app.on(method, route.path, handler);
}
```

This preserves type safety through the Hono middleware chain without silencing
the type checker.

### Pattern Summary

| What            | Where it lives                   | How to use it                                                       |
| --------------- | -------------------------------- | ------------------------------------------------------------------- |
| Module shape    | `../types.ts`                    | Import `BlennyModule`                                               |
| Framework state | `../core/app-state.ts`           | Import `AppState`, use in `initialize()`                            |
| Auth helpers    | `../core/auth.ts`                | Import `UserInfo`, `AuthConfig`, `createToken`, etc.                |
| Event topics    | In the module that fires them    | `declare module "@blenny/types" { interface BlennyEvents { ... } }` |
| Capabilities    | In the module that provides them | `capabilities: ["my-feature"]`                                      |

Every module is self-documenting — its event declarations and capability
declarations tell the framework and other modules what it provides. A
centralized auto-generated manifest exists only for compiled binaries (see
[Compiled Binaries & Module Manifest](#compiled-binaries--module-manifest)).

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

Test files live in `tests/` and mirror the module structure. Use Hono's
`app.request()` for HTTP-level tests:

```ts
import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import myModule from "../src/modules/my-module.ts";
import { BlennyConfig } from "../src/core/config.ts";
import { TransportHub } from "../src/core/hub.ts";
import { Conduit } from "../src/core/conduit.ts";
import type { AppState } from "../src/core/app-state.ts";
import type { HttpMethod } from "../src/types.ts";

async function buildApp(): Promise<Hono> {
  const config = new BlennyConfig();
  const hub = new TransportHub();
  const conduit = new Conduit();
  const state: AppState = { hub, conduit, config };
  const app = new Hono();

  await myModule.initialize?.(state);

  for (const route of myModule.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    app.on(method, route.path, handler);
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
