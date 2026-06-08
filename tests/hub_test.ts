import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  type Connection,
  type ConnId,
  publish,
  subscribe,
  TransportHub,
} from "../src/core/hub.ts";
import { BlennyError } from "../src/core/error.ts";
import type { Intent, ServerMessage } from "../src/core/envelope.ts";

class CaptureConnection implements Connection {
  id: ConnId;
  userId?: string;
  intents?: Set<Intent>;
  connType: string;
  sent: string[] = [];
  closeCallCount = 0;
  lastWriteAt: number;

  constructor(
    id: string,
    userId?: string,
    intents?: Set<Intent>,
    connType = "capture",
  ) {
    this.id = id;
    this.userId = userId;
    this.intents = intents;
    this.connType = connType;
    this.lastWriteAt = Date.now();
  }

  send(msg: ServerMessage): void {
    this.sent.push(JSON.stringify(msg));
  }

  close(): void {
    this.closeCallCount++;
  }
}

class ThrowingConnection implements Connection {
  id: ConnId;
  connType = "throwing" as const;
  lastWriteAt: number;
  private throwOnCall: number;
  callCount = 0;

  constructor(id: string, throwOnCall = 1) {
    this.id = id;
    this.lastWriteAt = Date.now();
    this.throwOnCall = throwOnCall;
  }

  send(_msg: ServerMessage): void {
    this.callCount++;
    if (this.callCount >= this.throwOnCall) {
      throw new Error("simulated send failure");
    }
  }
}

class AsyncRejectConnection implements Connection {
  id: ConnId;
  connType = "async" as const;
  lastWriteAt: number;
  private rejectOnCall: number;
  callCount = 0;

  constructor(id: string, rejectOnCall = 1) {
    this.id = id;
    this.lastWriteAt = Date.now();
    this.rejectOnCall = rejectOnCall;
  }

  send(_msg: ServerMessage): Promise<void> {
    this.callCount++;
    if (this.callCount >= this.rejectOnCall) {
      return Promise.reject(new Error("simulated async send failure"));
    }
    return Promise.resolve();
  }
}

Deno.test("TransportHub", async (t) => {
  await t.step("registerConnection returns a cleanup function", () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    const cleanup = hub.registerConnection(conn);
    assertEquals(typeof cleanup, "function");
  });

  await t.step("patchElements broadcasts to all connections", () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    hub.patchElements("<div>hello</div>");

    assertEquals(conn.sent.length, 1);
    const msg = JSON.parse(conn.sent[0]) as { html: string };
    assertEquals(msg.html, "<div>hello</div>");
  });

  await t.step("patchElements delivers to specific user only", () => {
    const hub = new TransportHub();
    const alice = new CaptureConnection(crypto.randomUUID(), "alice");
    const bob = new CaptureConnection(crypto.randomUUID(), "bob");
    hub.registerConnection(alice);
    hub.registerConnection(bob);

    hub.patchElements("<div>alice-only</div>", { userId: "alice" });

    assertEquals(alice.sent.length, 1);
    assertEquals(bob.sent.length, 0);
  });

  await t.step("patchElements respects intent filtering", () => {
    const hub = new TransportHub();
    const ui = new CaptureConnection(
      crypto.randomUUID(),
      undefined,
      new Set<Intent>(["ui"]),
    );
    const cmd = new CaptureConnection(
      crypto.randomUUID(),
      undefined,
      new Set<Intent>(["command"]),
    );
    hub.registerConnection(ui);
    hub.registerConnection(cmd);

    hub.patchElements("<div>ui-only</div>");

    assertEquals(ui.sent.length, 1);
    assertEquals(cmd.sent.length, 0);
  });

  await t.step("mergeSignals broadcasts correctly", () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    hub.mergeSignals({ x: 1, y: 2 });

    assertEquals(conn.sent.length, 1);
    const msg = JSON.parse(conn.sent[0]) as { signals: Record<string, unknown> };
    assertEquals(msg.signals, { x: 1, y: 2 });
  });

  await t.step("executeScript broadcasts correctly", () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    hub.executeScript("console.log('hi')");

    assertEquals(conn.sent.length, 1);
    const msg = JSON.parse(conn.sent[0]) as { script: string };
    assertEquals(msg.script, "console.log('hi')");
  });

  await t.step("nop broadcast to no connections is safe", () => {
    const hub = new TransportHub();
    hub.patchElements("<div>hello</div>");
    hub.mergeSignals({ x: 1 });
    hub.executeScript("console.log('hi')");
  });

  await t.step("nop direct to nonexistent user is safe", () => {
    const hub = new TransportHub();
    hub.patchElements("<div>hello</div>", { userId: "ghost" });
  });

  await t.step("closeAllConnections removes all connections", () => {
    const hub = new TransportHub();
    const a = new CaptureConnection(crypto.randomUUID());
    const b = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(a);
    hub.registerConnection(b);
    assertEquals(hub.getConnections().length, 2);

    hub.closeAllConnections();
    assertEquals(hub.getConnections().length, 0);
  });

  await t.step("closeAllConnections is safe on empty hub", () => {
    const hub = new TransportHub();
    hub.closeAllConnections();
    assertEquals(hub.getConnections().length, 0);
  });

  await t.step("closeAllConnections calls close() on each connection", () => {
    const hub = new TransportHub();
    const a = new CaptureConnection(crypto.randomUUID());
    const b = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(a);
    hub.registerConnection(b);

    hub.closeAllConnections();
    assertEquals(a.closeCallCount, 1);
    assertEquals(b.closeCallCount, 1);
  });

  await t.step(
    "write removes connection on sync send error",
    () => {
      const origWarn = console.warn;
      console.warn = () => {};

      try {
        const hub = new TransportHub();
        const conn = new ThrowingConnection(crypto.randomUUID(), 1);
        hub.registerConnection(conn);

        hub.mergeSignals({ test: "value" });

        assertEquals(hub.getConnections().length, 0);
      } finally {
        console.warn = origWarn;
      }
    },
  );

  await t.step(
    "write removes connection on async send rejection",
    async () => {
      const origWarn = console.warn;
      console.warn = () => {};

      try {
        const hub = new TransportHub();
        const conn = new AsyncRejectConnection(crypto.randomUUID(), 1);
        hub.registerConnection(conn);

        hub.mergeSignals({ test: "value" });
        await new Promise((r) => setTimeout(r, 0));

        assertEquals(hub.getConnections().length, 0);
      } finally {
        console.warn = origWarn;
      }
    },
  );

  await t.step(
    "connection without intents receives intent-scoped broadcasts",
    () => {
      const hub = new TransportHub();
      const any = new CaptureConnection(crypto.randomUUID());
      hub.registerConnection(any);

      hub.patchElements("<div>intent-scoped</div>");

      assertEquals(any.sent.length, 1);
    },
  );

  await t.step(
    "registerConnection throws BlennyError on global limit",
    () => {
      const hub = new TransportHub({ maxConns: 1 });
      hub.registerConnection(new CaptureConnection(crypto.randomUUID()));
      assertThrows(
        () =>
          hub.registerConnection(new CaptureConnection(crypto.randomUUID())),
        BlennyError,
        "connection limit reached",
      );
    },
  );

  await t.step(
    "registerConnection throws BlennyError on per-user limit",
    () => {
      const hub = new TransportHub({ maxConnsPerUser: 1 });
      const userId = crypto.randomUUID();
      hub.registerConnection(
        new CaptureConnection(crypto.randomUUID(), userId),
      );
      assertThrows(
        () =>
          hub.registerConnection(
            new CaptureConnection(crypto.randomUUID(), userId),
          ),
        BlennyError,
        "per-user connection limit reached",
      );
    },
  );

  await t.step("multiple intent groups receive correct broadcasts", () => {
    const hub = new TransportHub();
    const ui = new CaptureConnection(
      crypto.randomUUID(),
      undefined,
      new Set<Intent>(["ui"]),
    );
    const both = new CaptureConnection(
      crypto.randomUUID(),
      undefined,
      new Set<Intent>(["ui", "data"]),
    );
    const cmd = new CaptureConnection(
      crypto.randomUUID(),
      undefined,
      new Set<Intent>(["command"]),
    );
    hub.registerConnection(ui);
    hub.registerConnection(both);
    hub.registerConnection(cmd);

    hub.mergeSignals({ msg: "data-update" });

    assertEquals(ui.sent.length, 0);
    assertEquals(both.sent.length, 1);
    assertEquals(cmd.sent.length, 0);
  });

  await t.step("broadcast without intent reaches all connections", () => {
    const hub = new TransportHub();
    const ui = new CaptureConnection(
      crypto.randomUUID(),
      undefined,
      new Set<Intent>(["ui"]),
    );
    const any = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(ui);
    hub.registerConnection(any);

    hub.patchElements("<div>everyone</div>");

    assertEquals(ui.sent.length, 1);
    assertEquals(any.sent.length, 1);
  });
});

Deno.test("Hub events", async (t) => {
  await t.step("subscribe + publish roundtrip", async () => {
    const results: number[] = [];
    const unsub = subscribe("platform:ready", (data) => {
      results.push(data.timestamp);
    });

    await publish("platform:ready", { timestamp: 42 });
    assertEquals(results, [42]);

    unsub();
  });

  await t.step("unsubscribe removes handler", async () => {
    const results: number[] = [];
    const unsub = subscribe("platform:ready", () => {
      results.push(1);
    });
    await publish("platform:ready", { timestamp: 1 });
    assertEquals(results, [1]);

    unsub();
    await publish("platform:ready", { timestamp: 2 });
    assertEquals(results, [1]);
  });
});

Deno.test("Hub drain", async (t) => {
  await t.step("empty hub resolves immediately", async () => {
    const hub = new TransportHub();
    await hub.drain(30_000);
  });

  await t.step("prevents new registrations while draining", async () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    const drainPromise = hub.drain(30_000);

    await assertRejects(
      () =>
        Promise.resolve().then(() =>
          hub.registerConnection(
            new CaptureConnection(crypto.randomUUID()),
          )
        ),
      BlennyError,
      "server is shutting down",
    );

    hub.removeConnection(conn.id);
    await drainPromise;
  });

  await t.step(
    "sends reconnect script to all connections",
    async () => {
      const hub = new TransportHub();
      const a = new CaptureConnection(crypto.randomUUID());
      const b = new CaptureConnection(crypto.randomUUID());
      hub.registerConnection(a);
      hub.registerConnection(b);

      const drainPromise = hub.drain(30_000);

      assertEquals(a.sent.length, 1);
      assertEquals(b.sent.length, 1);
      const msgA = JSON.parse(a.sent[0]) as { script: string };
      assertEquals(typeof msgA.script, "string");
      assertStringIncludes(msgA.script, "setTimeout");
      assertStringIncludes(msgA.script, "location.reload");

      hub.removeConnection(a.id);
      hub.removeConnection(b.id);
      await drainPromise;
    },
  );

  await t.step(
    "resolves when all connections drain naturally",
    async () => {
      const hub = new TransportHub();
      const conn = new CaptureConnection(crypto.randomUUID());
      hub.registerConnection(conn);

      const drainPromise = hub.drain(30_000);

      hub.removeConnection(conn.id);
      await drainPromise;
    },
  );

  await t.step(
    "resolves via timeout fallback when connections hang",
    async () => {
      const hub = new TransportHub();
      const conn = new CaptureConnection(crypto.randomUUID());
      hub.registerConnection(conn);

      await hub.drain(50);
      assertEquals(conn.closeCallCount, 1);
    },
  );

  await t.step("is idempotent", async () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    const p1 = hub.drain(30_000);
    const p2 = hub.drain(30_000);
    assertEquals(p1, p2);

    hub.removeConnection(conn.id);
    await p1;
  });
});
