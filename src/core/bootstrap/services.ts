import { Hono } from "@hono/hono";
import pkg from "../../../package.json" with { type: "json" };
import type { AppState } from "../app-state.ts";
import { Conduit } from "../conduit.ts";
import type { BlennyConfig } from "../config.ts";
import { TransportHub } from "../hub.ts";
import { createLogger } from "../logger.ts";
import { BlennyPublisher } from "../publisher.ts";
import { TaskSupervisor } from "../task-supervisor.ts";

export async function createServices(config: BlennyConfig) {
  const hub = new TransportHub({
    maxConns: config.maxConnections,
    maxConnsPerUser: config.maxConnectionsPerUser,
  });
  BlennyPublisher.init(hub);
  const conduit = new Conduit();
  await createLogger(config);
  const supervisor = new TaskSupervisor();
  const state: AppState = {
    hub,
    conduit,
    config,
    supervisor,
    startTime: Date.now(),
    version: pkg.version,
  };
  const app = new Hono();
  return { hub, conduit, state, app, supervisor };
}
