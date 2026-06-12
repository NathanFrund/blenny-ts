import type { ServerMessage } from "./envelope.ts";

export interface MailboxMessage {
  from: string;
  msg: ServerMessage;
  targetUserId?: string;
}

export interface WorkerMailboxOptions {
  maxBroadcast?: number;
  maxDirect?: number;
}

const LOG_ONCE = new Set<string>();

function logOnce(key: string, message: string): void {
  if (!LOG_ONCE.has(key)) {
    LOG_ONCE.add(key);
    console.warn(`[mailbox] ${message}`);
  }
}

export class WorkerMailbox {
  private broadcastQueue: MailboxMessage[] = [];
  private directQueue: MailboxMessage[] = [];
  private draining = false;
  private handler: (item: MailboxMessage) => void;
  private maxBroadcast: number;
  private maxDirect: number;

  constructor(
    handler: (item: MailboxMessage) => void,
    opts?: WorkerMailboxOptions,
  ) {
    this.handler = handler;
    this.maxBroadcast = opts?.maxBroadcast ?? 10_000;
    this.maxDirect = opts?.maxDirect ?? 5_000;
  }

  push(from: string, msg: ServerMessage, targetUserId?: string): void {
    const item: MailboxMessage = { from, msg, targetUserId };

    if (targetUserId) {
      if (this.directQueue.length >= this.maxDirect) {
        logOnce("direct-overflow", "Direct mailbox overflow — dropping message");
        return;
      }
      this.directQueue.push(item);
    } else {
      if (this.broadcastQueue.length >= this.maxBroadcast) {
        this.broadcastQueue.shift();
        logOnce("broadcast-overflow", "Broadcast mailbox overflow — dropping oldest message");
      }
      this.broadcastQueue.push(item);
    }

    this.scheduleDrain();
  }

  get depth(): number {
    return this.broadcastQueue.length + this.directQueue.length;
  }

  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    queueMicrotask(() => this.drain());
  }

  private drain(): void {
    const bq = this.broadcastQueue;
    const dq = this.directQueue;

    while (bq.length > 0) {
      const item = bq.shift()!;
      try {
        this.handler(item);
      } catch (err) {
        console.error("[mailbox] Error processing broadcast message:", err);
      }
    }

    while (dq.length > 0) {
      const item = dq.shift()!;
      try {
        this.handler(item);
      } catch (err) {
        console.error("[mailbox] Error processing direct message:", err);
      }
    }

    this.draining = false;
  }

  drainNow(): void {
    this.draining = true;
    this.drain();
  }
}
