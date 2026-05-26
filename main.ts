import { Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { serveStatic } from "@hono/hono/deno";
import { publish, subscribe, TransportHub } from "./src/core/hub.ts";
import { Conduit } from "./src/core/conduit.ts";
import type { Intent } from "./src/core/envelope.ts";
import { loadModules } from "./src/core/module-loader.ts";
import type { AppState } from "./src/core/app-state.ts";
import type { BlennyEvents, BlennyModule } from "./src/types.ts";

const hub = new TransportHub();
const conduit = new Conduit();
const state: AppState = { hub, conduit };
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

// 3. Register routes
for (const mod of modules) {
  for (const route of mod.routes) {
    app.on(route.method, route.path, route.handler);
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

// 5. Start — background tasks
for (const mod of modules) {
  await mod.start?.();
  if (mod.start) console.log(`[lifecycle] ${mod.name} started`);
}

// ── Platform endpoints ──────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", modules: modules.length }));

app.get("/sse", (c) => {
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();

  const intentParam = c.req.query("intent");
  const intents = intentParam
    ? new Set(intentParam.split(",") as Intent[])
    : undefined;

  const cleanup = hub.registerConnection(writer, undefined, intents);

  c.req.raw.signal.addEventListener("abort", () => {
    cleanup();
    writer.close().catch(() => {});
  });

  return c.newResponse(readable, {
    headers: {
      "Content-Type": hub.getEncoder().contentType,
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.use("/static/*", serveStatic({ root: "./" }));

// ── Server with graceful shutdown ───────────────────────────────

const controller = new AbortController();
Deno.addSignalListener("SIGINT", () => controller.abort());
Deno.addSignalListener("SIGTERM", () => controller.abort());

const server = Deno.serve({ port: 3000, signal: controller.signal, onListen: () => {
  publish("platform:ready", { timestamp: Date.now() });
  console.log("blenny-ts running on http://localhost:3000");
} }, app.fetch);

await server.finished;

// 6. Stop modules in reverse order
for (const mod of modules.toReversed()) {
  await mod.stop?.();
  if (mod.stop) console.log(`[lifecycle] ${mod.name} stopped`);
}

console.log("blenny-ts shutdown complete");
