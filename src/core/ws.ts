import { upgradeWebSocket } from "@hono/hono/deno";
import type { WSContext } from "@hono/hono/ws";
import type { Context } from "@hono/hono";
import type { TransportHub } from "./hub.ts";
import { publish } from "./hub.ts";
import type { Intent } from "./envelope.ts";

function createWsWriter(ws: WSContext): WritableStreamDefaultWriter {
  const decoder = new TextDecoder();
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = decoder.decode(chunk);
      for (const block of text.split("\n\n")) {
        if (!block) continue;
        const dataMatch = block.match(/^data: (.+)$/m);
        if (dataMatch) {
          ws.send(dataMatch[1]);
        }
      }
    },
  });
  return writable.getWriter();
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
        const writer = createWsWriter(ws);
        cleanup = hub.registerConnection(writer, userId, intents);
      },
      onMessage(evt: MessageEvent, _ws: WSContext) {
        const raw = typeof evt.data === "string"
          ? evt.data
          : new TextDecoder().decode(evt.data as ArrayBuffer);
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
