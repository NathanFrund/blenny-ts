import type { Context } from "@hono/hono";
import type { TransportHub, Connection } from "./hub.ts";
import { publish } from "./hub.ts";
import type { Intent, ServerMessage } from "./envelope.ts";

export class WsConnection implements Connection {
  id: string;
  userId?: string;
  intents?: Set<Intent>;
  connType = "ws" as const;

  constructor(
    private ws: WebSocket,
    id: string,
    userId?: string,
    intents?: Set<Intent>,
  ) {
    this.id = id;
    this.userId = userId;
    this.intents = intents;
  }

  send(msg: ServerMessage): void {
    if (msg.html) this.ws.send(msg.html);
    if (msg.signals) this.ws.send(JSON.stringify(msg.signals));
    if (msg.script) this.ws.send(msg.script);
  }
}

export function dispatchWsMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg.topic === "string" && msg.payload !== undefined) {
      (publish as unknown as (t: string, p: unknown) => void)(
        msg.topic,
        msg.payload,
      );
    }
  } catch {
    // silently ignore malformed messages
  }
}

export function createWsHandler(hub: TransportHub, idleTimeoutMs: number) {
  return (c: Context): Response => {
    const user = c.get("user") as { id: string } | undefined;
    const intentParam = c.req.query("intent");
    const intents = intentParam
      ? new Set(intentParam.split(",") as Intent[])
      : undefined;
    const userId = user?.id;

    try {
      const { socket, response } = Deno.upgradeWebSocket(c.req.raw, {
        idleTimeout: idleTimeoutMs > 0
          ? Math.floor(idleTimeoutMs / 1000)
          : undefined,
      });

      let cleanup: (() => void) | undefined;

      socket.onopen = () => {
        const conn = new WsConnection(
          socket,
          crypto.randomUUID(),
          userId,
          intents,
        );
        cleanup = hub.registerConnection(conn);
      };

      socket.onmessage = (evt: MessageEvent) => {
        const raw = typeof evt.data === "string"
          ? evt.data
          : new TextDecoder().decode(evt.data as ArrayBuffer);
        dispatchWsMessage(raw);
      };

      socket.onclose = () => {
        cleanup?.();
        cleanup = undefined;
      };

      socket.onerror = () => {
        cleanup?.();
        cleanup = undefined;
      };

      return response;
    } catch {
      return c.text("WebSocket upgrade failed", 500);
    }
  };
}
