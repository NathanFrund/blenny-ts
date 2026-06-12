import { assertEquals } from "@std/assert";
import { WorkerTransport, type MessageChannel } from "../src/core/worker-transport.ts";
import { WorkerMailbox } from "../src/core/worker-mailbox.ts";
import type { ServerMessage } from "../src/core/envelope.ts";

function msg(): ServerMessage {
  return { intent: "ui", html: "<div>test</div>" };
}

Deno.test("transport does not deliver to self", () => {
  let receivedOnMessage: ((e: MessageEvent) => void) | null = null;
  const selfChannel: MessageChannel = {
    postMessage(_data: unknown) {
      // Simulate self-delivery: call our own onmessage immediately
      receivedOnMessage!({ data: _data } as MessageEvent);
    },
    get onmessage() { return receivedOnMessage; },
    set onmessage(cb) { receivedOnMessage = cb; },
    close() {},
  };

  const received: unknown[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));
  const t = new WorkerTransport(mb, selfChannel);

  t.sendMessage(msg());

  mb.drainNow();
  assertEquals(received.length, 0);

  t.close();
});

Deno.test("transport routes serverMessage to mailbox", () => {
  // Manually invoke the dispatch logic by feeding a message through
  // the transport's onmessage handler
  let onMsg: ((e: MessageEvent) => void) | null = null;
  const channel: MessageChannel = {
    postMessage() {},
    get onmessage() { return onMsg; },
    set onmessage(cb) { onMsg = cb; },
    close() {},
  };

  const received: unknown[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));
  const t = new WorkerTransport(mb, channel);

  // Simulate an incoming message from another worker
  const fakeEvent = {
    data: {
      from: "other-worker-id",
      type: "serverMessage",
      msg: msg(),
    },
  } as MessageEvent;
  onMsg!(fakeEvent);

  mb.drainNow();
  assertEquals(received.length, 1);
  const item = received[0] as { from: string; msg: ServerMessage };
  assertEquals((item.msg as { html: string }).html, "<div>test</div>");

  t.close();
});

Deno.test("transport routes serverMessage with targetUserId", () => {
  let onMsg: ((e: MessageEvent) => void) | null = null;
  const channel: MessageChannel = {
    postMessage() {},
    get onmessage() { return onMsg; },
    set onmessage(cb) { onMsg = cb; },
    close() {},
  };

  const received: unknown[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));
  const t = new WorkerTransport(mb, channel);

  onMsg!({
    data: {
      from: "other-worker",
      type: "serverMessage",
      msg: msg(),
      targetUserId: "user-123",
    },
  } as MessageEvent);
  mb.drainNow();

  assertEquals(received.length, 1);
  assertEquals((received[0] as { targetUserId?: string }).targetUserId, "user-123");

  t.close();
});

Deno.test("transport routes heartbeat to callback", () => {
  let onMsg: ((e: MessageEvent) => void) | null = null;
  const channel: MessageChannel = {
    postMessage() {},
    get onmessage() { return onMsg; },
    set onmessage(cb) { onMsg = cb; },
    close() {},
  };

  const mb = new WorkerMailbox(() => {});
  const t = new WorkerTransport(mb, channel);

  const heartbeats: string[] = [];
  t.onHeartbeat = (id) => heartbeats.push(id);

  onMsg!({
    data: { from: "worker-x", type: "heartbeat" },
  } as MessageEvent);

  assertEquals(heartbeats.length, 1);
  assertEquals(heartbeats[0], "worker-x");

  t.close();
});

Deno.test("transport routes drain to callback", () => {
  let onMsg: ((e: MessageEvent) => void) | null = null;
  const channel: MessageChannel = {
    postMessage() {},
    get onmessage() { return onMsg; },
    set onmessage(cb) { onMsg = cb; },
    close() {},
  };

  const mb = new WorkerMailbox(() => {});
  const t = new WorkerTransport(mb, channel);

  let drained = false;
  t.onDrain = () => { drained = true; };

  onMsg!({
    data: { from: "worker-y", type: "drain" },
  } as MessageEvent);

  assertEquals(drained, true);

  t.close();
});

Deno.test("transport close prevents dispatch", () => {
  let onMsg: ((e: MessageEvent) => void) | null = null;
  const channel: MessageChannel = {
    postMessage() {},
    get onmessage() { return onMsg; },
    set onmessage(cb) { onMsg = cb; },
    close() {},
  };

  const received: unknown[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));
  const t = new WorkerTransport(mb, channel);

  t.close();

  onMsg!({
    data: { from: "worker-z", type: "serverMessage", msg: msg() },
  } as MessageEvent);
  mb.drainNow();

  assertEquals(received.length, 0);
});
