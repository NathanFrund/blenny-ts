import type { Hono } from "@hono/hono";
import { publish } from "../hub.ts";
import type { TransportHub } from "../hub.ts";
import type { BlennyConfig } from "../config.ts";
import type { BlennyLogger } from "../logger.ts";

export function startServer(
  app: Hono,
  config: BlennyConfig,
  hub: TransportHub,
  logger: BlennyLogger,
): { finished: Promise<void> } {
  const controller = new AbortController();
  Deno.addSignalListener("SIGINT", () => controller.abort());
  Deno.addSignalListener("SIGTERM", () => controller.abort());

  const server = Deno.serve({
    hostname: config.bindAddress,
    port: config.port,
    signal: controller.signal,
    onListen: ({ port: p }) => {
      publish("platform:ready", { timestamp: Date.now() }).catch(() => {});
      hub.startReaper(config.idleTimeoutMs);
      logger.info("blenny-ts listening on port {port}", { port: p });
    },
  }, app.fetch);

  return { finished: server.finished };
}
