import type { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import type { Intent, ServerMessage } from "./envelope.ts";
import type { Connection } from "./hub.ts";

export class SseConnection implements Connection {
  id: string;
  userId?: string;
  intents?: Set<Intent>;
  connType = "sse" as const;
  lastWriteAt: number;

  constructor(
    private stream: ServerSentEventGenerator,
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
        this.stream.patchElements(msg.html);
        break;
      case "data":
        this.stream.patchSignals(JSON.stringify(msg.signals));
        break;
      case "command":
        this.stream.executeScript(msg.script);
        break;
    }
  }

  close(): void {
    this.stream.close();
  }
}
