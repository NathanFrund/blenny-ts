import { Hono } from "@hono/hono";
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
  const logger = await createLogger(config);
  const supervisor = new TaskSupervisor(logger);
  const state: AppState = { hub, conduit, config, logger, supervisor };
  const app = new Hono();
  return { hub, conduit, logger, state, app, supervisor };
}
