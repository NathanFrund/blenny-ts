import type { MiddlewareHandler } from "@hono/hono";
import type { Surreal } from "@surrealdb/surrealdb";
import type { TransportHub } from "./hub.ts";
import type { Conduit } from "./conduit.ts";
import type { AuthConfig } from "./auth.ts";
import type { BlennyConfig } from "./config.ts";
import type { BlennyLogger } from "./logger.ts";
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
  logger: BlennyLogger;
  auth?: AuthBundle;
  db?: Surreal;
}
