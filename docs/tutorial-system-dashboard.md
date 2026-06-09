# Tutorial: Build a System Dashboard Module

In this tutorial you'll create a live system dashboard module. By the end you'll
have a working `/system` page (auth-protected) that shows memory usage, load
average, and hostname — all streamed live every 5 seconds via Datastar SSE with
no page refresh.

**Time:** ~10 minutes

---

## Step 1: Create the module directory

```
docs/examples/system-dashboard/
  state.ts
  ui.tsx
  handlers.tsx
  index.ts
```

Copy the directory into `src/modules/system/` to activate it. Any directory
under `src/modules/` with an `index.ts` is auto-discovered — no config, no
registry.

> The completed example lives at `docs/examples/system-dashboard/` for
> reference. Code snippets below use `../../` imports relative to
> `src/modules/system/`.

---

## Step 2: Module state (`state.ts`)

Module-level state is a plain exported object. No classes, no DI — just a shared
typed object that `index.ts`, `handlers.tsx`, and `ui.tsx` import.

```ts
import type { TransportHub } from "../../core/hub.ts";

export const state = {
  hub: undefined! as unknown as TransportHub,
  intervalHandle: undefined as ReturnType<typeof setInterval> | undefined,
  startedAt: 0,
};
```

The `hub` reference is set during `initialize()`. The `intervalHandle` is set
during `start()` and cleared during `stop()`.

---

## Step 3: UI component (`ui.tsx`)

A JSX component renders the dashboard with Datastar `data-text` bindings that
reactively update from SSE signals:

```tsx
import type { FC } from "@hono/hono/jsx";

const Dashboard: FC = () => (
  <div>
    <h1>System Dashboard</h1>
    <p style="color:#666">Updates every 5 seconds via Datastar SSE</p>
    <table style="text-align:left">
      <tr>
        <td>
          <strong>Hostname</strong>
        </td>
        <td data-text="$.sys.hostname">—</td>
      </tr>
      <tr>
        <td>
          <strong>Memory Total</strong>
        </td>
        <td data-text="$.sys.memTotal">—</td>
      </tr>
      <tr>
        <td>
          <strong>Memory Used</strong>
        </td>
        <td data-text="$.sys.memUsed">—</td>
      </tr>
      <tr>
        <td>
          <strong>Memory Free</strong>
        </td>
        <td data-text="$.sys.memFree">—</td>
      </tr>
      <tr>
        <td>
          <strong>Load Average</strong>
        </td>
        <td>
          <span data-text="$.sys.load1m">—</span> /
          <span data-text="$.sys.load5m">—</span> /
          <span data-text="$.sys.load15m">—</span>
        </td>
      </tr>
      <tr>
        <td>
          <strong>Process Uptime</strong>
        </td>
        <td>
          <span data-text="$.sys.uptime">—</span> hours
        </td>
      </tr>
      <tr>
        <td>
          <strong>Collected At</strong>
        </td>
        <td data-text="$.sys.collectedAt">—</td>
      </tr>
    </table>
    <p>
      <a href="/dashboard">Back to Dashboard</a>
    </p>
  </div>
);

export default Dashboard;
```

Each `data-text="$.sys.hostname"` binds to a signal pushed from the server. The
initial `—` shows until the first SSE message arrives.

---

## Step 4: Route handler (`handlers.tsx`)

The handler serves a full HTML page with the Datastar client library and opens
an SSE connection scoped to the `system` intent:

```tsx
import type { Context } from "@hono/hono";
import Dashboard from "./ui.tsx";

export async function handleDashboard(c: Context): Promise<Response> {
  return c.html(
    <html>
      <head>
        <title>System Dashboard</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.1/bundles/datastar.js"
        >
        </script>
      </head>
      <body>
        <div
          data-init="@get('/sse?intent=data')"
          data-signals='{"sys":{"hostname":"","memTotal":0,"memUsed":0,"memFree":0,"load1m":0,"load5m":0,"load15m":0,"uptime":0,"collectedAt":""}}'
        >
          <Dashboard />
        </div>
      </body>
    </html>,
  );
}
```

Key details:

- **`data-init="@get('/sse?intent=data')"`** — on page load, opens an SSE
  connection and subscribes to signals delivered via the `data` intent.
- **`data-signals`** — initialises the `sys` signal namespace with defaults.
  Datastar merges incoming values into this reactive object.
- The page is rendered server-side as a complete HTML document (no Conduit
  layout needed — this is a standalone dashboard).

---

## Step 5: Module definition (`index.ts`)

This is where routes, lifecycle hooks, and the metric-push loop live:

```ts
import type { AppState } from "../../core/app-state.ts";
import type { BlennyModule } from "../../types.ts";
import { publish } from "../../core/hub.ts";
import { state } from "./state.ts";
import { handleDashboard } from "./handlers.tsx";

function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

const systemModule: BlennyModule = {
  name: "system",
  routes: [
    {
      method: "GET",
      path: "/system",
      auth: true,
      handler: handleDashboard,
    },
  ],
  initialize(state_: AppState) {
    state.hub = state_.hub;
  },
  start() {
    state.startedAt = Date.now();
    const push = () => {
      try {
        const mem = Deno.systemMemoryInfo();
        const loadAvg = Deno.loadavg?.() ?? [];
        state.hub.mergeSignals({
          sys: {
            hostname: Deno.hostname(),
            memTotal: bytes(mem.total),
            memUsed: bytes(mem.total - mem.free),
            memFree: bytes(mem.free),
            load1m: (loadAvg[0] ?? 0).toFixed(2),
            load5m: (loadAvg[1] ?? 0).toFixed(2),
            load15m: (loadAvg[2] ?? 0).toFixed(2),
            uptime: ((Date.now() - state.startedAt) / 3600000).toFixed(1),
            collectedAt: new Date().toLocaleTimeString(),
          },
        });
      } catch (err) {
        publish("log", {
          level: "error",
          template: "System metrics push failed: {error}",
          args: { error: String(err) },
        });
      }
    };
    push();
    state.intervalHandle = setInterval(push, 5_000);
  },
  stop() {
    if (state.intervalHandle) clearInterval(state.intervalHandle);
  },
};

export default systemModule;
```

Key points:

- **`auth: true`** — the route requires a signed-in user. Unauthenticated
  visitors are redirected to `/auth/signin`.
- **`initialize()`** — called once at boot. Grab the `hub` from `AppState` and
  store it in module state.
- **`start()`** — called after ALL modules have initialized. Safe to start the
  push loop here.
- **`hub.mergeSignals(data)`** — pushes Datastar signals to every SSE connection
  subscribed to `?intent=data`. The client's `data-text` bindings reactively
  update.
- **`stop()`** — called on shutdown. Clear the interval to prevent leaks.

---

## Step 6: Try it

```sh
deno task dev
```

Sign in at `/auth/signin` (default: admin/admin), then visit `/system`.

The page shows live metrics that update every 5 seconds with no refresh. Open
the browser DevTools network tab — you'll see the persistent SSE connection
pushing `datastar-merge-signals` events.

---

## Step 7: Add `--allow-sys` to your task

If you use a custom `dev` task, make sure it includes `--allow-sys`:

```
deno run --allow-net --allow-read --allow-sys --watch src/app.ts
```

The module uses `Deno.systemMemoryInfo()`, `Deno.hostname()`, and
`Deno.loadavg()` — all require the `sys` permission.

---

## What you learned

| Concept                    | Where                                                      |
| -------------------------- | ---------------------------------------------------------- |
| Module auto-discovery      | Just drop a directory in `src/modules/`                    |
| Route with `auth: true`    | `routes` array in module definition                        |
| Datastar SSE signals       | `hub.mergeSignals()` server-side + `data-text` on client   |
| Intent-based filtering     | `hub.mergeSignals(data)` targets `data` intent subscribers |
| Module-level state         | Shared `state` object in `state.ts`                        |
| `initialize()` hook        | Grab references from `AppState`                            |
| `start()` / `stop()` hooks | Timers, connections, cleanup                               |
| Event publishing           | `publish("log", ...)` for errors                           |
| Deno built-ins             | `systemMemoryInfo()`, `loadavg()`, `hostname()`            |

The system dashboard is a real, working example in
`docs/examples/system-dashboard/`. Copy it into `src/modules/system/` to try it,
then build your own.
