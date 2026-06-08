import type { MiddlewareHandler } from "@hono/hono";
import type { TransportHub } from "./hub.ts";
import type { Conduit } from "./conduit.ts";
import type { DbManager } from "./db-manager.ts";
import type { AuthConfig } from "./auth.ts";
import type { BlennyConfig } from "./config.ts";
import type { TaskSupervisor } from "./task-supervisor.ts";

export interface AuthBundle {
  config: AuthConfig;
  middleware: MiddlewareHandler;
  requireUser: MiddlewareHandler;
  requireRole: (...roles: string[]) => MiddlewareHandler;
}

export interface AppState {
  hub: TransportHub;
  conduit: Conduit;
  config: BlennyConfig;
  supervisor: TaskSupervisor;
  auth?: AuthBundle;
  db?: DbManager;
  moduleCount?: number;
  startTime: number;
  version: string;
}
