import { upgradeWebSocket } from "@hono/hono/deno";
import type { WSContext } from "@hono/hono/ws";
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
    private ws: WSContext,
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

export function createWsHandler(hub: TransportHub) {
  return upgradeWebSocket((c: Context) => {
    const intentParam = c.req.query("intent");
    const intents = intentParam
      ? new Set(intentParam.split(",") as Intent[])
      : undefined;

    const user = c.get("user") as { id: string } | undefined;
    const userId = user?.id;
    let cleanup: (() => void) | undefined;

    return {
      onOpen(_evt: Event, ws: WSContext) {
        const id = crypto.randomUUID();
        const conn = new WsConnection(ws, id, userId, intents);
        cleanup = hub.registerConnection(conn);
      },
      onMessage(evt: MessageEvent, _ws: WSContext) {
        const raw = typeof evt.data === "string"
          ? evt.data
          : new TextDecoder().decode(evt.data as ArrayBuffer);
        dispatchWsMessage(raw);
      },
      onClose(_evt: CloseEvent, _ws: WSContext) {
        if (cleanup) {
          cleanup();
          cleanup = undefined;
        }
      },
    };
  });
}
