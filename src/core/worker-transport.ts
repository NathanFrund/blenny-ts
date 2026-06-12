import type { ServerMessage } from "./envelope.ts";
import { getWorkerId } from "./worker-id.ts";
import type { WorkerMailbox } from "./worker-mailbox.ts";

const CHANNEL = "blenny:transport";

export interface TransportMessage {
  from: string;
  type: "serverMessage" | "heartbeat" | "drain";
  msg?: ServerMessage;
  targetUserId?: string;
  payload?: Record<string, unknown>;
}

export interface MessageChannel {
  postMessage(data: unknown): void;
  onmessage: ((e: MessageEvent<TransportMessage>) => void) | null;
  close(): void;
}

export class WorkerTransport {
  readonly workerId: string;
  private channel: MessageChannel;
  private alive = true;

  onHeartbeat: ((workerId: string) => void) | null = null;
  onDrain: (() => void) | null = null;

  constructor(
    private mailbox: WorkerMailbox,
    channel?: MessageChannel,
  ) {
    this.workerId = getWorkerId();
    this.channel = channel ?? new BroadcastChannel(CHANNEL);
    this.channel.onmessage = (e: MessageEvent<TransportMessage>) => {
      if (!this.alive) return;
      if (e.data.from === this.workerId) return;
      this.dispatch(e.data);
    };
  }

  sendMessage(msg: ServerMessage, targetUserId?: string): void {
    this.post({
      type: "serverMessage",
      msg,
      targetUserId,
    });
  }

  sendHeartbeat(): void {
    this.post({ type: "heartbeat" });
  }

  sendDrain(): void {
    this.post({ type: "drain" });
  }

  private dispatch(data: TransportMessage): void {
    switch (data.type) {
      case "serverMessage": {
        this.mailbox.push(data.from, data.msg!, data.targetUserId);
        break;
      }
      case "heartbeat": {
        this.onHeartbeat?.(data.from);
        break;
      }
      case "drain": {
        this.onDrain?.();
        break;
      }
    }
  }

  private post(data: Omit<TransportMessage, "from">): void {
    if (!this.alive) return;
    this.channel.postMessage({ ...data, from: this.workerId });
  }

  close(): void {
    this.alive = false;
    this.channel.close();
  }
}
