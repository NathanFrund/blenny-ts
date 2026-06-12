import { assertEquals } from "@std/assert";
import { WorkerMailbox, type MailboxMessage } from "../src/core/worker-mailbox.ts";
import type { ServerMessage } from "../src/core/envelope.ts";

function msg(html?: string): ServerMessage {
  return { intent: "ui", html: html ?? "<div>test</div>" };
}

Deno.test("mailbox delivers messages in order", () => {
  const received: MailboxMessage[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));

  mb.push("w1", msg("a"), undefined);
  mb.push("w2", msg("b"), undefined);
  mb.drainNow();

  assertEquals(received.length, 2);
  assertEquals((received[0].msg as { html: string }).html, "a");
  assertEquals((received[1].msg as { html: string }).html, "b");
});

Deno.test("mailbox routes broadcast vs direct to correct queue", () => {
  const received: MailboxMessage[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));

  mb.push("w1", msg("broadcast"));
  mb.push("w2", msg("direct"), "user-123");
  mb.drainNow();

  assertEquals(received.length, 2);
  assertEquals(received[0].targetUserId, undefined);
  assertEquals(received[1].targetUserId, "user-123");
});

Deno.test("mailbox microtask drain fires asynchronously", async () => {
  const received: MailboxMessage[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));

  mb.push("w1", msg());
  assertEquals(received.length, 0, "should not drain synchronously");

  await new Promise((r) => setTimeout(r, 0));
  assertEquals(received.length, 1, "should drain on microtask");
});

Deno.test("broadcast queue drops oldest on overflow", () => {
  const received: MailboxMessage[] = [];
  const mb = new WorkerMailbox((item) => received.push(item), { maxBroadcast: 3 });

  mb.push("w1", msg("a"));
  mb.push("w1", msg("b"));
  mb.push("w1", msg("c"));
  mb.push("w1", msg("d"));
  mb.drainNow();

  assertEquals(received.length, 3);
  assertEquals((received[0].msg as { html: string }).html, "b");
  assertEquals((received[1].msg as { html: string }).html, "c");
  assertEquals((received[2].msg as { html: string }).html, "d");
});

Deno.test("direct queue drops newest on overflow", () => {
  const received: MailboxMessage[] = [];
  const mb = new WorkerMailbox((item) => received.push(item), { maxDirect: 2 });

  mb.push("w1", msg("a"), "u1");
  mb.push("w1", msg("b"), "u1");
  mb.push("w1", msg("c"), "u1");
  mb.drainNow();

  assertEquals(received.length, 2);
  assertEquals((received[0].msg as { html: string }).html, "a");
  assertEquals((received[1].msg as { html: string }).html, "b");
});

Deno.test("mailbox handler error does not block remaining items", () => {
  const received: MailboxMessage[] = [];
  let callCount = 0;
  const mb = new WorkerMailbox((item) => {
    callCount++;
    if (callCount === 1) throw new Error("handler fail");
    received.push(item);
  });

  mb.push("w1", msg("a"));
  mb.push("w1", msg("b"));
  mb.drainNow();

  assertEquals(received.length, 1);
  assertEquals((received[0].msg as { html: string }).html, "b");
});

Deno.test("mailbox depth tracks total items", () => {
  const mb = new WorkerMailbox(() => {});

  assertEquals(mb.depth, 0);
  mb.push("w1", msg(), undefined);
  assertEquals(mb.depth, 1);
  mb.push("w1", msg(), "user-123");
  assertEquals(mb.depth, 2);
  mb.drainNow();
  assertEquals(mb.depth, 0);
});

Deno.test("drainNow is idempotent", () => {
  const received: MailboxMessage[] = [];
  const mb = new WorkerMailbox((item) => received.push(item));

  mb.push("w1", msg("a"));
  mb.drainNow();
  assertEquals(received.length, 1);

  mb.drainNow();
  assertEquals(received.length, 1, "second drainNow should not re-process");
});
