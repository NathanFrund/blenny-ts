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
  app.get(
    "/health",
    (c) => c.json({ status: "ok", modules: state.moduleCount ?? 0 }),
  );

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

  app.use("/static/*", serveStatic({ root: "./static" }));
}
