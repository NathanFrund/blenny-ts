import type { MiddlewareHandler } from "@hono/hono";
import type { TransportHub } from "./hub.ts";
import type { Conduit } from "./conduit.ts";
import type { AuthConfig } from "./auth.ts";

export interface AuthBundle {
  config: AuthConfig;
  middleware: MiddlewareHandler;
  requireUser: MiddlewareHandler;
  requireRole: (...roles: string[]) => MiddlewareHandler;
}

export interface AppState {
  hub: TransportHub;
  conduit: Conduit;
  auth?: AuthBundle;
}
