import { Hono } from "@hono/hono";
import { logger } from "@hono/hono/logger";
import { serveStatic } from "@hono/hono/deno";
import { publish, subscribe, TransportHub } from "./src/core/hub.ts";
import type { Intent } from "./src/core/envelope.ts";
import { loadModules } from "./src/core/module-loader.ts";
import type { BlennyEvents } from "./src/types.ts";

const hub = new TransportHub();
const app = new Hono();
app.use(logger());

const modules = await loadModules();

for (const mod of modules) {
  for (const route of mod.routes) {
    app.on(route.method, route.path, route.handler);
    console.log(`[router] ${route.method} ${route.path} -> ${mod.name}`);
  }
  if (mod.subscriptions) {
    for (const sub of mod.subscriptions) {
      subscribe(sub.topic as keyof BlennyEvents, sub.handler as (payload: unknown) => void);
      console.log(`[bus] ${mod.name} subscribed to "${sub.topic}"`);
    }
  }
}

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

Deno.serve({ port: 3000, onListen: () => {
  publish("platform:ready", { timestamp: Date.now() });
} }, app.fetch);

console.log("blenny-ts running on http://localhost:3000");
