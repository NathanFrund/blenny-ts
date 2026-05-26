import type { Connection } from "./hub.ts";
import type { ServerMessage } from "./envelope.ts";
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { Intent } from "./envelope.ts";

export class SseConnection implements Connection {
  id: string;
  userId?: string;
  intents?: Set<Intent>;

  constructor(
    private stream: ServerSentEventGenerator,
    id: string,
    userId?: string,
    intents?: Set<Intent>,
  ) {
    this.id = id;
    this.userId = userId;
    this.intents = intents;
  }

  send(msg: ServerMessage): void {
    if (msg.html) this.stream.patchElements(msg.html);
    if (msg.signals) this.stream.patchSignals(JSON.stringify(msg.signals));
    if (msg.script) this.stream.executeScript(msg.script);
  }
}
