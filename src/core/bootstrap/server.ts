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
      publish("platform:ready", { timestamp: Date.now() }).catch(() => {});
      hub.startReaper(config.idleTimeoutMs);
      publish("log", {
        level: "info",
        template: "blenny-ts listening on port {port}",
        args: { port: p },
      });
    },
  }, app.fetch);

  return { finished: server.finished };
}
