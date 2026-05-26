import type { Intent, ServerMessage } from "./envelope.ts";
import type { BlennyEvents } from "../types.ts";

// ── Typed event bus ──────────────────────────────────────────────

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

// ── Connection interface ────────────────────────────────────────

export type ConnId = string;

export interface Connection {
  id: ConnId;
  userId?: string;
  intents?: Set<Intent>;
  send(msg: ServerMessage): void;
}

// ── TransportHub ─────────────────────────────────────────────────

export class TransportHub {
  private conns = new Map<ConnId, Connection>();
  private userConns = new Map<string, Map<ConnId, true>>();

  // ── Connection management ───────────────────────────────────

  registerConnection(conn: Connection): () => void {
    this.conns.set(conn.id, conn);
    if (conn.userId) {
      if (!this.userConns.has(conn.userId)) {
        this.userConns.set(conn.userId, new Map());
      }
      this.userConns.get(conn.userId)!.set(conn.id, true);
    }
    return () => this.removeConnection(conn.id);
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
    conn.send(msg);
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
