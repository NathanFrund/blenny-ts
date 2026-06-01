import { assertEquals, assertThrows } from "@std/assert";
import { type Connection, type ConnId, TransportHub } from "../src/core/hub.ts";
import { BlennyError } from "../src/core/error.ts";
import type { Intent, ServerMessage } from "../src/core/envelope.ts";

class CaptureConnection implements Connection {
  id: ConnId;
  userId?: string;
  intents?: Set<Intent>;
  connType = "capture" as const;
  sent: string[] = [];

  constructor(id: string, userId?: string, intents?: Set<Intent>) {
    this.id = id;
    this.userId = userId;
    this.intents = intents;
  }

  send(msg: ServerMessage): void {
    this.sent.push(JSON.stringify(msg));
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
    const msg = JSON.parse(conn.sent[0]) as ServerMessage;
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

    hub.patchElements("<div>ui-only</div>", { intent: "ui" });

    assertEquals(ui.sent.length, 1);
    assertEquals(cmd.sent.length, 0);
  });

  await t.step("mergeSignals broadcasts correctly", () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    hub.mergeSignals({ x: 1, y: 2 });

    assertEquals(conn.sent.length, 1);
    const msg = JSON.parse(conn.sent[0]) as ServerMessage;
    assertEquals(msg.signals, { x: 1, y: 2 });
  });

  await t.step("executeScript broadcasts correctly", () => {
    const hub = new TransportHub();
    const conn = new CaptureConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    hub.executeScript("console.log('hi')");

    assertEquals(conn.sent.length, 1);
    const msg = JSON.parse(conn.sent[0]) as ServerMessage;
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

  await t.step("registerConnection throws BlennyError on global limit", () => {
    const hub = new TransportHub({ maxConns: 1 });
    hub.registerConnection(new CaptureConnection(crypto.randomUUID()));
    assertThrows(
      () => hub.registerConnection(new CaptureConnection(crypto.randomUUID())),
      BlennyError,
      "connection limit reached",
    );
  });

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
});
