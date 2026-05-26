import type { TransportEncoder } from "../transport-encoder.ts";
import type { ServerMessage } from "../envelope.ts";

export class StandardEncoder implements TransportEncoder {
  readonly name = "standard";
  readonly contentType = "text/event-stream";

  encode(msg: ServerMessage): string {
    const data: Record<string, unknown> = {};
    if (msg.html !== undefined) data.html = msg.html;
    if (msg.signals !== undefined) data.signals = msg.signals;
    if (msg.script !== undefined) data.script = msg.script;
    return `event: message\ndata: ${JSON.stringify(data)}\n\n`;
  }
}
