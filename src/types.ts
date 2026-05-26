import { Context } from "@hono/hono";
import type { AppState } from "./core/app-state.ts";
import type { LayoutComponent } from "./core/conduit.ts";

// The contract for any community module dropped into Blenny
export interface Route {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  handler: (c: Context) => Response | Promise<Response>;
  auth?: boolean | string;
}

export interface BlennyModule {
  name: string;
  enabled?: boolean;
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