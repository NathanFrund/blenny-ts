import type { Intent, ServerMessage } from "./envelope.ts";
import type { BlennyEvents } from "../types.ts";
import { BlennyError } from "./error.ts";
import { TaskSupervisor } from "./task-supervisor.ts";
import {
  activeConnections,
  messageDuration,
  messagesSent,
  recordDuration,
  SpanStatusCode,
  withSpan,
} from "./tracing.ts";

// ── Typed event bus ──────────────────────────────────────────────

type Handler<T> = (payload: T) => void | Promise<void>;
const eventSubs = new Map<keyof BlennyEvents, Set<Handler<unknown>>>();

export function subscribe<K extends keyof BlennyEvents>(
  topic: K,
  handler: Handler<BlennyEvents[K]>,
): () => void {
  if (!eventSubs.has(topic)) {
    eventSubs.set(topic, new Set());
  }
  eventSubs.get(topic)!.add(handler as Handler<unknown>);
  return () => eventSubs.get(topic)?.delete(handler as Handler<unknown>);
}

export async function publish<K extends keyof BlennyEvents>(
  topic: K,
  payload: BlennyEvents[K],
): Promise<void> {
  const handlers = eventSubs.get(topic);
  if (!handlers) return;
  const results: (void | Promise<void>)[] = [];
  for (const handler of handlers) {
    try {
      results.push((handler as Handler<BlennyEvents[K]>)(payload));
    } catch (err) {
      console.error(`[hub] Error in handler for "${String(topic)}":`, err);
    }
  }
  await Promise.allSettled(results);
}

// ── Connection interface ────────────────────────────────────────

export type ConnId = string;

export interface Connection {
  id: ConnId;
  userId?: string;
  intents?: Set<Intent>;
  connType: string;
  lastWriteAt: number;
  send(msg: ServerMessage): void | Promise<void>;
  close?(): void;
}

// ── TransportHub ─────────────────────────────────────────────────

export class TransportHub {
  private conns = new Map<ConnId, Connection>();
  private userConns = new Map<string, Set<ConnId>>();
  private sseConns = new Set<Connection>();
  private intentGroups = new Map<Intent, Set<ConnId>>();
  private noIntentConns = new Set<ConnId>();
  private reaperSupervisor = new TaskSupervisor();
  private reaperIdleMs = 300_000;
  private draining = false;
  private drainPromise: Promise<void> | null = null;
  private drainResolve: (() => void) | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  maxConns: number;
  maxConnsPerUser: number;

  constructor(opts?: { maxConns?: number; maxConnsPerUser?: number }) {
    this.maxConns = opts?.maxConns ?? 10_000;
    this.maxConnsPerUser = opts?.maxConnsPerUser ?? 100;
  }

  // ── SSE connection reaper ────────────────────────────────────

  startReaper(idleTimeoutMs: number, intervalMs = 30_000): void {
    this.reaperIdleMs = idleTimeoutMs;
    this.reaperSupervisor.stop();
    this.reaperSupervisor.add(
      "reaper",
      () => this.reapIdleConnections(),
      intervalMs,
    );
    this.reaperSupervisor.start();
  }

  private reapIdleConnections(): void {
    const now = Date.now();
    for (const conn of this.sseConns) {
      if (now - conn.lastWriteAt > this.reaperIdleMs) {
        this.removeConnection(conn.id);
      }
    }
  }

  stopReaper(): void {
    this.reaperSupervisor.stop();
  }

  drain(timeoutMs = 30_000): Promise<void> {
    if (this.draining) return this.drainPromise ?? Promise.resolve();
    this.draining = true;
    this.stopReaper();

    if (this.conns.size === 0) return Promise.resolve();

    this.drainPromise = new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });

    this.drainTimer = setTimeout(() => {
      this.closeAllConnections();
      this.drainResolve?.();
      this.drainResolve = null;
    }, timeoutMs);

    // Send staggered reconnect script to every connection, bypassing intent filtering
    for (const conn of this.conns.values()) {
      const delay = randomInt(1_000, 6_000);
      conn.send({ script: `setTimeout(()=>location.reload(),${delay})` });
    }

    return this.drainPromise;
  }

  closeAllConnections(): void {
    for (const id of this.conns.keys()) {
      this.removeConnection(id);
    }
  }

  // ── Connection management ───────────────────────────────────

  registerConnection(conn: Connection): () => void {
    if (this.draining) {
      throw new BlennyError(
        "draining",
        "server is shutting down",
        503,
      );
    }
    if (this.conns.size >= this.maxConns) {
      throw new BlennyError(
        "too_many_connections",
        `connection limit reached (${this.maxConns})`,
        503,
      );
    }
    if (conn.userId) {
      const userSet = this.userConns.get(conn.userId) ?? new Set();
      if (userSet.size >= this.maxConnsPerUser) {
        throw new BlennyError(
          "too_many_connections",
          `per-user connection limit reached (${this.maxConnsPerUser})`,
          429,
        );
      }
      this.userConns.set(conn.userId, userSet);
      userSet.add(conn.id);
    }
    this.conns.set(conn.id, conn);
    conn.lastWriteAt ??= Date.now();
    if (conn.connType === "sse") this.sseConns.add(conn);
    if (conn.intents) {
      for (const intent of conn.intents) {
        if (!this.intentGroups.has(intent)) {
          this.intentGroups.set(intent, new Set());
        }
        this.intentGroups.get(intent)!.add(conn.id);
      }
    } else {
      this.noIntentConns.add(conn.id);
    }
    activeConnections.add(1, { "conn.type": conn.connType });
    return () => this.removeConnection(conn.id);
  }

  removeConnection(id: ConnId): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    activeConnections.add(-1, { "conn.type": conn.connType });
    this.conns.delete(id);
    this.sseConns.delete(conn);
    if (conn.intents) {
      for (const intent of conn.intents) {
        const set = this.intentGroups.get(intent);
        if (set) {
          set.delete(id);
          if (set.size === 0) this.intentGroups.delete(intent);
        }
      }
    } else {
      this.noIntentConns.delete(id);
    }
    if (conn.userId) {
      const userSet = this.userConns.get(conn.userId);
      userSet?.delete(id);
      if (userSet?.size === 0) this.userConns.delete(conn.userId);
    }
    conn.close?.();

    if (this.draining && this.conns.size === 0) {
      if (this.drainTimer !== null) clearTimeout(this.drainTimer);
      this.drainTimer = null;
      this.drainResolve?.();
      this.drainResolve = null;
    }
  }

  // ── Internal dispatch ───────────────────────────────────────

  private async write(msg: ServerMessage, conn: Connection): Promise<void> {
    if (msg.intent && conn.intents && !conn.intents.has(msg.intent)) {
      return;
    }
    const start = performance.now();
    try {
      const result = conn.send(msg);
      if (result instanceof Promise) await result;
      conn.lastWriteAt = Date.now();
      messagesSent.add(1, {
        "conn.type": conn.connType,
        "msg.intent": msg.intent ?? "none",
      });
      recordDuration(messageDuration, start, {
        "conn.type": conn.connType,
      });
    } catch (err) {
      console.warn(
        `[hub] Send failed for ${conn.id}, removing connection`,
        err,
      );
      this.removeConnection(conn.id);
      throw err;
    }
  }

  // ── Introspection ────────────────────────────────────────────

  getConnections(): Connection[] {
    return Array.from(this.conns.values());
  }

  // ── Actions (module-facing API) ──────────────────────────────

  patchElements(
    html: string,
    opts?: { intent?: Intent; userId?: string },
  ): Promise<void> {
    return this.sendMessage({ intent: opts?.intent, html }, opts?.userId);
  }

  mergeSignals(
    data: Record<string, unknown>,
    opts?: { intent?: Intent; userId?: string },
  ): Promise<void> {
    return this.sendMessage(
      { intent: opts?.intent, signals: data },
      opts?.userId,
    );
  }

  /**
   * Execute JavaScript on connected clients.
   * Script is sent verbatim — only use with trusted content.
   * For untrusted input, use `patchElements` or `mergeSignals` instead.
   */
  executeScript(
    script: string,
    opts?: { intent?: Intent; userId?: string },
  ): Promise<void> {
    return this.sendMessage({ intent: opts?.intent, script }, opts?.userId);
  }

  private sendMessage(
    msg: ServerMessage,
    targetUserId?: string,
  ): Promise<void> {
    if (targetUserId) {
      return this.directToUser(msg, targetUserId);
    } else {
      return this.broadcastToAll(msg);
    }
  }

  // ── Low-level broadcast ──────────────────────────────────────

  private async broadcastToAll(msg: ServerMessage): Promise<void> {
    if (this.conns.size === 0) return;
    await withSpan("hub.broadcast", async (span) => {
      span.setAttribute("msg.intent", msg.intent ?? "none");
      const writes: Promise<void>[] = [];
      if (msg.intent) {
        const group = this.intentGroups.get(msg.intent);
        if (group) {
          for (const id of group) {
            const conn = this.conns.get(id);
            if (conn) writes.push(this.write(msg, conn));
          }
        }
        for (const id of this.noIntentConns) {
          const conn = this.conns.get(id);
          if (conn) writes.push(this.write(msg, conn));
        }
      } else {
        for (const conn of this.conns.values()) {
          writes.push(this.write(msg, conn));
        }
      }
      const results = await Promise.allSettled(writes);
      const failed = results.filter((r) => r.status === "rejected");
      span.setAttribute("conn.count", this.conns.size);
      if (failed.length > 0) {
        span.setAttribute("write.errors", failed.length);
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
    });
  }

  private async directToUser(
    msg: ServerMessage,
    userId: string,
  ): Promise<void> {
    const userSet = this.userConns.get(userId);
    if (!userSet || userSet.size === 0) return;
    await withSpan("hub.direct", async (span) => {
      span.setAttribute("user.id", userId);
      const writes: Promise<void>[] = [];
      for (const id of userSet) {
        const conn = this.conns.get(id);
        if (conn) writes.push(this.write(msg, conn));
      }
      const results = await Promise.allSettled(writes);
      const failed = results.filter((r) => r.status === "rejected");
      span.setAttribute("conn.count", writes.length);
      if (failed.length > 0) {
        span.setAttribute("write.errors", failed.length);
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
    });
  }
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
