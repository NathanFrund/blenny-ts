# Tutorial: Build a System Dashboard Module

In this tutorial you'll create a live system dashboard module. By the end you'll
have a working `/system` page (auth-protected) that shows memory usage, load
average, and hostname — all collected every 5 seconds via the module's lifecycle
hooks.

**Time:** ~10 minutes

---

## Step 1: Create the module directory

```
src/modules/system/
  state.ts
  ui.tsx
  handlers.tsx
  index.ts
```

Any directory under `src/modules/` with an `index.ts` is auto-discovered.
Drop the files in and restart — no config, no registry.

---

## Step 2: Module state (`state.ts`)

Module-level state is a plain exported object. No classes, no DI — just a shared
typed object that `index.ts`, `handlers.tsx`, and `ui.tsx` import.

```ts
import type { Conduit } from "../../core/conduit.ts";

export interface SystemMetrics {
  memory: { total: number; free: number; used: number };
  loadAvg: number[];
  hostname: string;
  startTime: number;
  collectedAt: string;
}

export const state = {
  conduit: undefined! as unknown as Conduit,
  metrics: undefined as SystemMetrics | undefined,
  intervalHandle: undefined as ReturnType<typeof setInterval> | undefined,
  startedAt: 0,
};
```

The `conduit` reference is set during `initialize()`. The `intervalHandle` is
set during `start()` and cleared during `stop()`.

---

## Step 3: UI component (`ui.tsx`)

A JSX component renders the metrics:

```tsx
import type { FC } from "@hono/hono/jsx";
import type { SystemMetrics } from "./state.ts";

const bytes = (n: number) => {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
};

const Dashboard: FC<{ metrics: SystemMetrics }> = ({ metrics }) => (
  <div>
    <h1>System Dashboard</h1>
    <table>
      <tr><td><strong>Hostname</strong></td><td>{metrics.hostname}</td></tr>
      <tr><td><strong>Memory Total</strong></td><td>{bytes(metrics.memory.total)}</td></tr>
      <tr><td><strong>Memory Used</strong></td><td>{bytes(metrics.memory.used)}</td></tr>
      <tr><td><strong>Memory Free</strong></td><td>{bytes(metrics.memory.free)}</td></tr>
      <tr><td><strong>Load Average</strong></td><td>{metrics.loadAvg.map((n) => n.toFixed(2)).join(", ")}</td></tr>
      <tr><td><strong>Process Uptime</strong></td><td>{((Date.now() - metrics.startTime) / 3600000).toFixed(1)} hours</td></tr>
      <tr><td><strong>Collected At</strong></td><td>{metrics.collectedAt}</td></tr>
    </table>
    <p><a href="/dashboard">Back to Dashboard</a></p>
  </div>
);

export default Dashboard;
```

---

## Step 4: Route handler (`handlers.tsx`)

Handlers read from module state and render through Conduit:

```tsx
import type { Context } from "@hono/hono";
import { state } from "./state.ts";
import Dashboard from "./ui.tsx";

export function handleDashboard(c: Context): Response | Promise<Response> {
  if (!state.metrics) {
    return c.text("Metrics not yet available — refresh in a moment", 503);
  }
  return state.conduit.respond(c, <Dashboard metrics={state.metrics} />);
}
```

`conduit.respond()` automatically detects HTMX requests and returns just the
fragment — no layout wrapping. Full page loads get the default layout.

---

## Step 5: Module definition (`index.ts`)

This is where routes, lifecycle hooks, and metric collection live:

```ts
import type { AppState } from "../../core/app-state.ts";
import type { BlennyModule } from "../../types.ts";
import { publish } from "../../core/hub.ts";
import { state, type SystemMetrics } from "./state.ts";
import { handleDashboard } from "./handlers.tsx";

function collectMetrics(): SystemMetrics {
  const mem = Deno.systemMemoryInfo();
  return {
    memory: { total: mem.total, free: mem.free, used: mem.total - mem.free },
    loadAvg: Deno.loadavg?.() ?? [],
    hostname: Deno.hostname(),
    startTime: state.startedAt,
    collectedAt: new Date().toISOString(),
  };
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
    state.conduit = state_.conduit;
  },
  start() {
    state.startedAt = Date.now();
    state.metrics = collectMetrics();
    state.intervalHandle = setInterval(() => {
      try {
        state.metrics = collectMetrics();
      } catch (err) {
        publish("log", {
          level: "error",
          template: "System metrics collection failed: {error}",
          args: { error: String(err) },
        });
      }
    }, 5_000);
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
- **`initialize()`** — called once at boot. Grab references from `AppState`
  (like `conduit`) and store them in module state.
- **`start()`** — called after ALL modules have initialized. Safe to start
  collection loops here.
- **`stop()`** — called on shutdown. Clean up timers to prevent leaks.

---

## Step 6: Try it

```sh
deno run dev
```

Sign in at `/auth/signin` (default: admin/admin), then visit `/system`.

The page refreshes with fresh metrics every 5 seconds. Hit the back button,
the timer stops cleanly.

---

## What you learned

| Concept | Where |
|---|---|
| Module auto-discovery | Just drop a directory in `src/modules/` |
| Route with `auth: true` | `routes` array in module definition |
| Conduit rendering | `conduit.respond(c, <Component />)` |
| Module-level state | Shared `state` object in `state.ts` |
| `initialize()` hook | Grab references from `AppState` |
| `start()` / `stop()` hooks | Timers, connections, cleanup |
| Event publishing | `publish("log", ...)` for errors |
| Deno built-ins | `systemMemoryInfo()`, `loadavg()`, `hostname()` |

The system dashboard is a real, working module in your project now —
`src/modules/system/`. Read it through, experiment with it, then build your own.
