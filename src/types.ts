import { Context } from "@hono/hono";
import type { AppState } from "./core/app-state.ts";

// The contract for any community module dropped into Blenny
export interface BlennyModule {
  name: string;
  enabled?: boolean;
  routes: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    handler: (c: Context) => Response | Promise<Response>;
  }[];
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
  "spatial:tick": { cycle: number; activeAgents: number };
  "platform:ready": { timestamp: number };
}