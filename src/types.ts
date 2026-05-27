import { Context } from "@hono/hono";
import type { AppState } from "./core/app-state.ts";
import type { LayoutComponent } from "./core/conduit.ts";

export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
export type HttpMethod = typeof HTTP_METHODS[number];

// The contract for any community module dropped into Blenny
export interface Route {
  method: HttpMethod;
  path: string;
  handler: (c: Context) => Response | Promise<Response>;
  auth?: boolean | string;
}

export interface BlennyModule {
  name: string;
  routes: Route[];
  layout?: LayoutComponent;
  subscriptions?: {
    topic: string;
    handler: (payload: unknown) => void;
  }[];
  initialize?(state: AppState): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}

// Strictly type pub/sub topics
export interface BlennyEvents {
  "auth:signin": { userId: string; timestamp: number };
  "auth:signout": { userId: string; timestamp: number };
  "spatial:tick": { cycle: number; activeAgents: number };
  "platform:ready": { timestamp: number };
}