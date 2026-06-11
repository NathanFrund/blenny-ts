import type { Hono } from "@hono/hono";
import { publish } from "../hub.ts";
import type { TransportHub } from "../hub.ts";
import type { BlennyConfig } from "../config.ts";

export function startServer(
  app: Hono,
  config: BlennyConfig,
  hub: TransportHub,
  signal?: AbortSignal,
): { finished: Promise<void> } {
  const server = Deno.serve({
    hostname: config.bindAddress,
    port: config.port,
    signal,
    onListen: ({ port: p }) => {
      publish("platform:ready", { timestamp: Date.now() }).catch((err) => {
        publish("log", {
          level: "error",
          template: "Failed to publish platform:ready: {error}",
          args: { error: String(err) },
        }).catch(() => {});
      });
      hub.startReaper(config.idleTimeoutMs);
      publish("log", {
        level: "info",
        template: "blenny-ts listening on port {port}",
        args: { port: p },
      });
    },
    onError: (err) => {
      publish("log", {
        level: "error",
        template: "Server error: {error}",
        args: { error: String(err) },
      });
      return new Response("Internal Server Error", { status: 500 });
    },
  }, app.fetch);

  return { finished: server.finished };
}
