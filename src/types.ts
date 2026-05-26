import { Context } from "@hono/hono";

// The contract for any community module dropped into Blenny
export interface BlennyModule {
  name: string;
  routes: {
    method: "GET" | "POST" | "PUT" | "DELETE";
    path: string;
    handler: (c: Context) => Response | Promise<Response>;
  }[];
  subscriptions?: {
    topic: string;
    handler: (payload: unknown) => void;
  }[];
}

// Strictly type pub/sub topics
export interface BlennyEvents {
  "auth:signin": { userId: string; timestamp: number };
  "spatial:tick": { cycle: number; activeAgents: number };
  "platform:ready": { timestamp: number };
}