import type { Intent, ServerMessage } from "./envelope.ts";
import type { TransportEncoder } from "./transport-encoder.ts";
import type { BlennyEvents } from "../types.ts";
import { DatastarEncoder } from "./encoders/datastar-encoder.ts";

// ── Typed event bus (absorbed from bus.ts) ──────────────────────────

type Handler<T> = (payload: T) => void;
const eventSubs = new Map<keyof BlennyEvents, Set<(payload: unknown) => void>>();

export function subscribe<K extends keyof BlennyEvents>(
  topic: K,
  handler: Handler<BlennyEvents[K]>,
): () => void {
  if (!eventSubs.has(topic)) {
    eventSubs.set(topic, new Set());
  }
  eventSubs.get(topic)!.add(handler as (payload: unknown) => void);
  return () => eventSubs.get(topic)?.delete(handler as (payload: unknown) => void);
}

export function publish<K extends keyof BlennyEvents>(
  topic: K,
  payload: BlennyEvents[K],
): void {
  const handlers = eventSubs.get(topic);
  if (handlers) {
    for (const handler of handlers) {
      (handler as Handler<BlennyEvents[K]>)(payload);
    }
  }
}

// ── TransportHub ────────────────────────────────────────────────────

type ConnId = string;

interface Connection {
  id: ConnId;
  userId?: string;
  intents?: Set<Intent>;
  writer: WritableStreamDefaultWriter;
}

export class TransportHub {
  private encoder: TransportEncoder;
  private conns = new Map<ConnId, Connection>();
  private userConns = new Map<string, Map<ConnId, true>>();

  constructor(encoder?: TransportEncoder) {
    this.encoder = encoder ?? new DatastarEncoder();
  }

  getEncoder(): TransportEncoder {
    return this.encoder;
  }

  setEncoder(encoder: TransportEncoder): void {
    this.encoder = encoder;
  }

  // ── Connection management ───────────────────────────────────

  registerConnection(
    writer: WritableStreamDefaultWriter,
    userId?: string,
    intents?: Set<Intent>,
  ): () => void {
    const id = crypto.randomUUID();
    const conn: Connection = { id, userId, intents, writer };
    this.conns.set(id, conn);
    if (userId) {
      if (!this.userConns.has(userId)) {
        this.userConns.set(userId, new Map());
      }
      this.userConns.get(userId)!.set(id, true);
    }
    return () => this.removeConnection(id);
  }

  private removeConnection(id: ConnId): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    this.conns.delete(id);
    if (conn.userId) {
      const userMap = this.userConns.get(conn.userId);
      if (userMap) {
        userMap.delete(id);
        if (userMap.size === 0) {
          this.userConns.delete(conn.userId);
        }
      }
    }
  }

  // ── Internal dispatch ───────────────────────────────────────

  private write(msg: ServerMessage, conn: Connection): void {
    if (msg.intent && conn.intents && !conn.intents.has(msg.intent)) {
      return;
    }
    const data = this.encoder.encode(msg);
    conn.writer.write(new TextEncoder().encode(data)).catch(() => {
      this.removeConnection(conn.id);
    });
  }

  // ── Actions (module-facing API) ──────────────────────────────

  patchElements(
    html: string,
    opts?: { intent?: Intent; userId?: string },
  ): void {
    const msg: ServerMessage = { intent: opts?.intent, html };
    if (opts?.userId) {
      this.directToUser(msg, opts.userId);
    } else {
      this.broadcastToAll(msg);
    }
  }

  mergeSignals(
    data: Record<string, unknown>,
    opts?: { intent?: Intent; userId?: string },
  ): void {
    const msg: ServerMessage = { intent: opts?.intent, signals: data };
    if (opts?.userId) {
      this.directToUser(msg, opts.userId);
    } else {
      this.broadcastToAll(msg);
    }
  }

  executeScript(
    script: string,
    opts?: { intent?: Intent; userId?: string },
  ): void {
    const msg: ServerMessage = { intent: opts?.intent, script };
    if (opts?.userId) {
      this.directToUser(msg, opts.userId);
    } else {
      this.broadcastToAll(msg);
    }
  }

  // ── Low-level broadcast ──────────────────────────────────────

  private broadcastToAll(msg: ServerMessage): void {
    for (const conn of this.conns.values()) {
      this.write(msg, conn);
    }
  }

  private directToUser(msg: ServerMessage, userId: string): void {
    const userMap = this.userConns.get(userId);
    if (!userMap) return;
    for (const id of userMap.keys()) {
      const conn = this.conns.get(id);
      if (conn) this.write(msg, conn);
    }
  }
}
