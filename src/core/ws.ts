import type { Context } from "@hono/hono";
import type { WebSocketHandler } from "bun";
import type { Intent, ServerMessage } from "./envelope.ts";
import type { Connection, TransportHub } from "./hub.ts";

/** Minimal socket surface WsConnection needs (Bun's ServerWebSocket satisfies it). */
export interface WsSocket {
  send(data: string): void;
  close?(code?: number, reason?: string): void;
}

export class WsConnection implements Connection {
  id: string;
  userId?: string;
  intents?: Set<Intent>;
  connType = "ws" as const;
  lastWriteAt: number;

  constructor(
    private ws: WsSocket,
    id: string,
    userId?: string,
    intents?: Set<Intent>,
  ) {
    this.id = id;
    this.userId = userId;
    this.intents = intents;
    this.lastWriteAt = Date.now();
  }

  send(msg: ServerMessage): void {
    switch (msg.intent) {
      case "ui":
        this.ws.send(msg.html);
        break;
      case "data":
        this.ws.send(JSON.stringify(msg.signals));
        break;
      case "command":
        this.ws.send(msg.script);
        break;
    }
  }

  close(): void {
    this.ws.close?.();
  }
}

/** Per-connection data attached at upgrade time. */
export interface WsData {
  userId?: string;
  intents?: Set<Intent>;
  cleanup?: () => void;
}

type UpgradeCapableServer = {
  upgrade(req: Request, opts?: { data?: WsData }): boolean;
};

function resolveServer(c: Context): UpgradeCapableServer | undefined {
  const env = c.env as (UpgradeCapableServer & { server?: UpgradeCapableServer }) | undefined;
  if (env && typeof env.upgrade === "function") return env;
  if (env?.server && typeof env.server.upgrade === "function") return env.server;
  return undefined;
}

/**
 * Bun.serve websocket handlers. Registered once at serve time; per-connection
 * state travels via `ws.data` set during `server.upgrade()`.
 */
export function createWebsocketHandlers(hub: TransportHub): WebSocketHandler<WsData> {
  return {
    data: {} as WsData,
    open(ws) {
      const conn = new WsConnection(ws, crypto.randomUUID(), ws.data.userId, ws.data.intents);
      ws.data.cleanup = hub.registerConnection(conn);
    },
    message() {
      // Server-push only: inbound messages are ignored.
    },
    close(ws) {
      ws.data.cleanup?.();
      ws.data.cleanup = undefined;
    },
  };
}

export function createWsHandler(_idleTimeoutMs: number) {
  return (c: Context): Response => {
    const user = c.get("user") as { id: string } | undefined;
    const intentParam = c.req.query("intent");
    const intents = intentParam ? new Set(intentParam.split(",") as Intent[]) : undefined;
    const userId = user?.id;

    const server = resolveServer(c);
    if (!server) {
      return c.text("WebSocket upgrade unavailable", 500);
    }

    const upgraded = server.upgrade(c.req.raw, {
      data: { userId, intents },
    });
    if (!upgraded) {
      return c.text("WebSocket upgrade failed", 500);
    }
    return c.body(null);
  };
}
