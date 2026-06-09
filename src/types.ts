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
  capabilities?: string[];
  requires?: string[];
  subscriptions?: {
    topic: string;
    handler: (payload: unknown) => void;
  }[];
  initialize?(state: AppState): void | Promise<void>;
  start?(): void | Promise<void>;
  stop?(): void | Promise<void>;
}

/**
 * Event bus topics.
 *
 * Framework core events are defined here. Modules extend this interface
 * via declaration merging — do NOT add module-specific events to this file.
 *
 * ```ts
 * declare module "@blenny/types" {
 *   interface BlennyEvents {
 *     "my:event": { field: string };
 *   }
 * }
 * ```
 */
export interface BlennyEvents {
  "platform:ready": { timestamp: number };
  "log": {
    level: "debug" | "info" | "warn" | "error";
    template: string;
    args?: Record<string, unknown>;
  };
}
