import type { Hono } from "@hono/hono";
import type { BlennyConfig } from "../config.ts";
import type { TransportHub } from "../hub.ts";
import { publish } from "../hub.ts";
import { createWebsocketHandlers } from "../ws.ts";

export function startServer(
  app: Hono,
  config: BlennyConfig,
  hub: TransportHub,
  signal?: AbortSignal,
): { finished: Promise<void> } {
  // Deno took an idle timeout in seconds per WS upgrade; Bun's equivalent is a
  // server-wide option in seconds, capped at 255. 0 disables the timeout.
  const idleTimeoutSec =
    config.idleTimeoutMs > 0 ? Math.min(255, Math.max(1, Math.floor(config.idleTimeoutMs / 1000))) : 0;

  const server = Bun.serve({
    hostname: config.bindAddress,
    port: config.port,
    idleTimeout: idleTimeoutSec,
    fetch: app.fetch,
    websocket: createWebsocketHandlers(hub),
    error(err) {
      publish("log", {
        level: "error",
        template: "Server error",
        error: err,
      });
      return new Response("Internal Server Error", { status: 500 });
    },
  });

  // Bun's ServeOptions type predates the onListen callback; run the startup
  // side effects immediately after serve() returns (the port is live here).
  publish("platform:ready", { timestamp: Date.now() }).catch((err) => {
    publish("log", {
      level: "error",
      template: "Failed to publish platform:ready",
      error: err,
    }).catch(() => {});
  });
  hub.startReaper(config.idleTimeoutMs);
  publish("log", {
    level: "info",
    template: "blenny-ts listening on port {port}",
    args: { port: server.port },
  });

  const finished = (async () => {
    if (signal) {
      if (!signal.aborted) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    }
    await server.stop();
  })();

  return { finished };
}
