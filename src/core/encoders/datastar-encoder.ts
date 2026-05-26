import type { TransportEncoder } from "../transport-encoder.ts";
import type { ServerMessage } from "../envelope.ts";

export class DatastarEncoder implements TransportEncoder {
  readonly name = "datastar";
  readonly contentType = "text/event-stream";

  encode(msg: ServerMessage): string {
    const lines: string[] = [];
    if (msg.html !== undefined) {
      lines.push(`event: datastar-patch-elements\ndata: ${msg.html}\n\n`);
    }
    if (msg.signals !== undefined) {
      lines.push(`event: datastar-merge-signals\ndata: ${JSON.stringify(msg.signals)}\n\n`);
    }
    if (msg.script !== undefined) {
      lines.push(`event: datastar-execute-script\ndata: ${msg.script}\n\n`);
    }
    return lines.join("");
  }
}
