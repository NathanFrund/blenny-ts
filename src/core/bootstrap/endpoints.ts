import type { Hono } from "@hono/hono";
import { serveStatic } from "@hono/hono/deno";
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { SseConnection } from "../sse-connection.ts";
import { createWsHandler } from "../ws.ts";
import { getUser } from "../auth.ts";
import type { AppState } from "../app-state.ts";
import type { BlennyConfig } from "../config.ts";
import type { Intent } from "../envelope.ts";

export function registerPlatformEndpoints(
  app: Hono,
  state: AppState,
  config: BlennyConfig,
): void {
  app.get("/health", (c) => {
    const uptime = Math.floor((Date.now() - state.startTime) / 1000);
    const dbStatus = state.db?.connected ? "connected" : "unavailable";
    const connections = state.hub.getConnections().length;
    return c.json({
      status: "ok",
      version: state.version,
      uptime,
      modules: state.moduleCount ?? 0,
      connections,
      db: dbStatus,
    });
  });

  app.get("/sse", async (c) => {
    const intentParam = c.req.query("intent");
    const intents = intentParam
      ? new Set(intentParam.split(",") as Intent[])
      : undefined;

    let userId: string | undefined;
    if (state.auth) {
      const transportConfig = { ...state.auth.config, allowQueryToken: true };
      const user = await getUser(c, transportConfig);
      if (user) userId = user.id;
    }

    if (state.auth && config.transportAuthRequired && !userId) {
      return c.text("Unauthorized", 401);
    }

    return ServerSentEventGenerator.stream(
      (stream) => {
        if (c.req.raw.signal.aborted) return;

        const id = crypto.randomUUID();
        const conn = new SseConnection(stream, id, userId, intents);
        const cleanup = state.hub.registerConnection(conn);

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

  const wsHandler = createWsHandler(state.hub, config.idleTimeoutMs);
  app.get("/ws", async (c) => {
    if (state.auth && config.transportAuthRequired) {
      const transportConfig = { ...state.auth.config, allowQueryToken: true };
      const user = await getUser(c, transportConfig);
      if (!user) return c.text("Unauthorized", 401);
    }
    return wsHandler(c);
  });

  app.use("/static/*", async (c, next) => {
    await next();
    if (c.res.status === 200 && !c.res.headers.has("Cache-Control")) {
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    }
  }, serveStatic({ root: "./static" }));
}
