import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { serveStatic } from "@hono/hono/deno";
import { BlennyConfig } from "./src/core/config.ts";
import { connectDatabase } from "./src/core/database.ts";
import { publish, subscribe, TransportHub } from "./src/core/hub.ts";
import { Conduit } from "./src/core/conduit.ts";
import { getUser } from "./src/core/auth.ts";
import type { Intent } from "./src/core/envelope.ts";
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { SseConnection } from "./src/core/sse-connection.ts";
import { createWsHandler } from "./src/core/ws.ts";
import { loadModules } from "./src/core/module-loader.ts";
import type { AppState } from "./src/core/app-state.ts";
import type { BlennyEvents, BlennyModule } from "./src/types.ts";

const config = new BlennyConfig();
config.logSources();

const hub = new TransportHub();
const conduit = new Conduit();
const state: AppState = { hub, conduit, config };
const app = new Hono();
app.use(logger());

const allModules = await loadModules();
const modules: BlennyModule[] = [];

// 1. Filter enabled modules
for (const mod of allModules) {
  if (mod.enabled === false) {
    console.log(`[lifecycle] ${mod.name} disabled, skipping`);
    continue;
  }
  modules.push(mod);
}

// 2. Initialize — inject dependencies
for (const mod of modules) {
  await mod.initialize?.(state);
  console.log(`[lifecycle] ${mod.name} initialized`);
}

// 2a. Apply auth middleware globally if an auth module was initialized
if (state.auth) {
  app.use("*", state.auth.middleware);
}

// 3. Register routes
for (const mod of modules) {
  for (const route of mod.routes) {
    const method = route.method as "GET" | "POST" | "PUT" | "DELETE";
    const handler = route.handler as unknown as MiddlewareHandler;
    if (route.auth && state.auth) {
      const guard: MiddlewareHandler =
        typeof route.auth === "string"
          ? state.auth.requireRole(route.auth)
          : state.auth.requireUser;
      app.on(method, route.path, guard, handler);
    } else {
      app.on(method, route.path, handler);
    }
    console.log(`[router] ${route.method} ${route.path} -> ${mod.name}`);
  }
}

// 4. Subscribe to typed events
for (const mod of modules) {
  if (mod.subscriptions) {
    for (const sub of mod.subscriptions) {
      subscribe(sub.topic as keyof BlennyEvents, sub.handler as (payload: unknown) => void);
      console.log(`[bus] ${mod.name} subscribed to "${sub.topic}"`);
    }
  }
}

// 4a. Connect database
state.db = (await connectDatabase(config)) ?? undefined;

// 5. Start — background tasks
for (const mod of modules) {
  await mod.start?.();
  if (mod.start) console.log(`[lifecycle] ${mod.name} started`);
}

// ── Platform endpoints ──────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", modules: modules.length }));

app.get("/sse", async (c) => {
  const intentParam = c.req.query("intent");
  const intents = intentParam
    ? new Set(intentParam.split(",") as Intent[])
    : undefined;

  let userId: string | undefined;
  if (state.auth) {
    const user = await getUser(c, state.auth.config);
    if (user) userId = user.id;
  }

  return ServerSentEventGenerator.stream(
    (stream) => {
      const id = crypto.randomUUID();
      const conn = new SseConnection(stream, id, userId, intents);
      const cleanup = hub.registerConnection(conn);

      return new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => {
          cleanup();
          resolve();
        });
      });
    },
    { keepalive: true },
  );
});

app.get("/ws", createWsHandler(hub));

app.use("/static/*", serveStatic({ root: "./" }));

// ── Server with graceful shutdown ───────────────────────────────

const controller = new AbortController();
Deno.addSignalListener("SIGINT", () => controller.abort());
Deno.addSignalListener("SIGTERM", () => controller.abort());

const server = Deno.serve({
  hostname: config.bindAddress,
  port: config.port,
  signal: controller.signal,
  onListen: ({ port: p }) => {
    publish("platform:ready", { timestamp: Date.now() });
    console.log(`blenny-ts running on http://localhost:${p}`);
  },
}, app.fetch);

await server.finished;

// 6. Stop modules in reverse order
for (const mod of modules.toReversed()) {
  await mod.stop?.();
  if (mod.stop) console.log(`[lifecycle] ${mod.name} stopped`);
}

// 7. Close database
await state.db?.close();

console.log("blenny-ts shutdown complete");
