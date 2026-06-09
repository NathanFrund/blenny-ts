import { Hono } from "@hono/hono";
import { NavRegistry } from "../nav-registry.ts";
import { BlennyConfig } from "../config.ts";
import { TransportHub } from "../hub.ts";
import { Conduit } from "../conduit.ts";
import { createLogger } from "../logger.ts";
import { BlennyPublisher } from "../publisher.ts";
import { TaskSupervisor } from "../task-supervisor.ts";
import type { AppState } from "../app-state.ts";

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
    nav: new NavRegistry(),
    startTime: Date.now(),
    version: "0.2.0",
  };
  const app = new Hono();
  return { hub, conduit, state, app, supervisor };
}
