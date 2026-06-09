import { assertEquals, assertThrows } from "@std/assert";
import { BlennyPublisher, PublisherError } from "@blenny/core/publisher.ts";
import { TransportHub } from "@blenny/core/hub.ts";
import { jsx } from "@hono/hono/jsx";
import type { Intent, ServerMessage } from "@blenny/core/envelope.ts";

class CaptureConnection {
  id: string;
  userId?: string;
  intents?: Set<Intent>;
  connType = "capture" as const;
  sent: string[] = [];
  lastWriteAt: number;

  constructor(id: string, userId?: string, intents?: Set<Intent>) {
    this.id = id;
    this.lastWriteAt = Date.now();
    this.userId = userId;
    this.intents = intents;
  }

  send(msg: ServerMessage): void {
    this.sent.push(JSON.stringify(msg));
  }
}

Deno.test("BlennyPublisher throws before init", () => {
  BlennyPublisher.reset();
  assertThrows(
    () => BlennyPublisher.broadcastHtml("<div>test</div>"),
    PublisherError,
  );
  assertThrows(
    () => BlennyPublisher.directHtml("<div>test</div>", "alice"),
    PublisherError,
  );
  assertThrows(
    () => BlennyPublisher.broadcastData('{"a":1}'),
    PublisherError,
  );
  assertThrows(
    () => BlennyPublisher.directData('{"a":1}', "alice"),
    PublisherError,
  );
});

Deno.test("BlennyPublisher init and reset lifecycle", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);
  // Should not throw after init
  BlennyPublisher.broadcastHtml("<div>test</div>");

  BlennyPublisher.reset();
  assertThrows(
    () => BlennyPublisher.broadcastHtml("<div>test</div>"),
    PublisherError,
  );
});

Deno.test("BlennyPublisher double init with different hub throws", () => {
  BlennyPublisher.reset();
  const hub1 = new TransportHub();
  const hub2 = new TransportHub();
  BlennyPublisher.init(hub1);
  assertThrows(
    () => BlennyPublisher.init(hub2),
    PublisherError,
    "already initialized",
  );
  // reset + re-init is fine
  BlennyPublisher.reset();
  BlennyPublisher.init(hub2);
  BlennyPublisher.broadcastHtml("<div>from hub2</div>");
});

Deno.test("BlennyPublisher re-init with same hub is a no-op", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);
  // Should not throw
  BlennyPublisher.init(hub);
});

Deno.test("BlennyPublisher broadcasts to all connections", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  const conn = new CaptureConnection("test-1");
  hub.registerConnection(conn);

  BlennyPublisher.broadcastHtml("<div>Hello</div>");
  assertEquals(conn.sent.length, 1);
  const msg = JSON.parse(conn.sent[0]) as { html: string };
  assertEquals(msg.html, "<div>Hello</div>");
});

Deno.test("BlennyPublisher broadcastData parses JSON internally", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  const conn = new CaptureConnection("test-1");
  hub.registerConnection(conn);

  BlennyPublisher.broadcastData('{"score":42,"name":"alice"}');
  assertEquals(conn.sent.length, 1);
  const msg = JSON.parse(conn.sent[0]) as {
    signals: Record<string, unknown>;
    intent: string;
  };
  assertEquals(msg.signals, { score: 42, name: "alice" });
  assertEquals(msg.intent, "data");
});

Deno.test("BlennyPublisher broadcastData rejects invalid JSON", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  assertThrows(
    () => BlennyPublisher.broadcastData("not-json"),
    PublisherError,
    "invalid JSON",
  );
});

Deno.test("BlennyPublisher broadcastData rejects non-object JSON", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  assertThrows(
    () => BlennyPublisher.broadcastData('"hello"'),
    PublisherError,
    "JSON object",
  );
  assertThrows(
    () => BlennyPublisher.broadcastData("42"),
    PublisherError,
    "JSON object",
  );
  assertThrows(
    () => BlennyPublisher.broadcastData("[1,2,3]"),
    PublisherError,
    "JSON object",
  );
  assertThrows(
    () => BlennyPublisher.broadcastData("null"),
    PublisherError,
    "JSON object",
  );
});

Deno.test("BlennyPublisher directs to specific user only", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  const alice = new CaptureConnection("alice-1", "alice");
  const bob = new CaptureConnection("bob-1", "bob");
  hub.registerConnection(alice);
  hub.registerConnection(bob);

  BlennyPublisher.directHtml("<div>Private for alice</div>", "alice");
  assertEquals(alice.sent.length, 1);
  assertEquals(bob.sent.length, 0);

  const msg = JSON.parse(alice.sent[0]) as { html: string };
  assertEquals(msg.html, "<div>Private for alice</div>");
});

Deno.test("BlennyPublisher directData to specific user", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  const alice = new CaptureConnection("alice-1", "alice");
  const bob = new CaptureConnection("bob-1", "bob");
  hub.registerConnection(alice);
  hub.registerConnection(bob);

  BlennyPublisher.directData('{"msg":"secret"}', "alice");
  assertEquals(alice.sent.length, 1);
  assertEquals(bob.sent.length, 0);

  const msg = JSON.parse(alice.sent[0]) as {
    signals: Record<string, unknown>;
    intent: string;
  };
  assertEquals(msg.signals, { msg: "secret" });
  assertEquals(msg.intent, "data");
});

Deno.test("BlennyPublisher broadcastJsx auto-escapes text content", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  const conn = new CaptureConnection("test-1");
  hub.registerConnection(conn);

  BlennyPublisher.broadcastJsx(
    jsx("p", null, "<script>alert(1)</script>"),
  );
  assertEquals(conn.sent.length, 1);
  const msg = JSON.parse(conn.sent[0]) as { html: string };
  assertEquals(msg.html, "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
});

Deno.test("BlennyPublisher broadcastJsx escapes attribute bindings", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  const conn = new CaptureConnection("test-1");
  hub.registerConnection(conn);

  BlennyPublisher.broadcastJsx(
    jsx(
      "div",
      { class: "msg", "data-x": '"><script>alert(1)</script>' },
      "hello",
    ),
  );
  assertEquals(conn.sent.length, 1);
  const msg = JSON.parse(conn.sent[0]) as { html: string };
  assertEquals(
    msg.html,
    '<div class="msg" data-x="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">hello</div>',
  );
});

Deno.test("BlennyPublisher directJsx targets specific user", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  const alice = new CaptureConnection("alice-1", "alice");
  const bob = new CaptureConnection("bob-1", "bob");
  hub.registerConnection(alice);
  hub.registerConnection(bob);

  BlennyPublisher.directJsx(
    jsx("strong", null, "Private message"),
    "alice",
  );
  assertEquals(alice.sent.length, 1);
  assertEquals(bob.sent.length, 0);

  const msg = JSON.parse(alice.sent[0]) as { html: string };
  assertEquals(msg.html, "<strong>Private message</strong>");
});

Deno.test("BlennyPublisher broadcastJsx throws before init", () => {
  BlennyPublisher.reset();
  assertThrows(
    () => BlennyPublisher.broadcastJsx(jsx("div", null, "test")),
    PublisherError,
  );
  assertThrows(
    () => BlennyPublisher.directJsx(jsx("div", null, "test"), "alice"),
    PublisherError,
  );
});

Deno.test("BlennyPublisher nop when no connections", () => {
  BlennyPublisher.reset();
  const hub = new TransportHub();
  BlennyPublisher.init(hub);

  BlennyPublisher.broadcastHtml("<div>hi</div>");
  BlennyPublisher.broadcastData('{"a":1}');
  BlennyPublisher.directHtml("<div>hi</div>", "ghost");
  BlennyPublisher.directData('{"a":1}', "ghost");
});
