import { assertEquals } from "@std/assert";
import { TransportHub } from "../src/core/hub.ts";
import type { Intent } from "../src/core/envelope.ts";

function makeWriter(): WritableStreamDefaultWriter {
  const { writable } = new TransformStream<Uint8Array>();
  return writable.getWriter();
}

Deno.test("TransportHub", async (t) => {
  await t.step("registerConnection returns a cleanup function", () => {
    const hub = new TransportHub();
    const cleanup = hub.registerConnection(makeWriter());
    assertEquals(typeof cleanup, "function");
  });

  await t.step("patchElements broadcasts to all connections", async () => {
    const hub = new TransportHub();
    const chunks: string[] = [];
    hub.registerConnection(makeCaptureWriter(chunks));

    hub.patchElements("<div>hello</div>");
    await new Promise((r) => setTimeout(r, 0));
    assertEquals(chunks.length, 1);
    assertEquals(chunks[0].includes("datastar-patch-elements"), true);
    assertEquals(chunks[0].includes("<div>hello</div>"), true);
  });

  await t.step("patchElements delivers to specific user only", async () => {
    const hub = new TransportHub();
    const aliceChunks: string[] = [];
    const bobChunks: string[] = [];

    hub.registerConnection(makeCaptureWriter(aliceChunks), "alice");
    hub.registerConnection(makeCaptureWriter(bobChunks), "bob");

    hub.patchElements("<div>alice-only</div>", { userId: "alice" });
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(aliceChunks.length, 1);
    assertEquals(bobChunks.length, 0);
  });

  await t.step("patchElements respects intent filtering", async () => {
    const hub = new TransportHub();
    const uiChunks: string[] = [];
    const cmdChunks: string[] = [];

    hub.registerConnection(
      makeCaptureWriter(uiChunks),
      undefined,
      new Set<Intent>(["ui"]),
    );
    hub.registerConnection(
      makeCaptureWriter(cmdChunks),
      undefined,
      new Set<Intent>(["command"]),
    );

    hub.patchElements("<div>ui-only</div>", { intent: "ui" });
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(uiChunks.length, 1);
    assertEquals(cmdChunks.length, 0);
  });

  await t.step("mergeSignals broadcasts correctly", async () => {
    const hub = new TransportHub();
    const chunks: string[] = [];
    hub.registerConnection(makeCaptureWriter(chunks));

    hub.mergeSignals({ x: 1, y: 2 });
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(chunks.length, 1);
    assertEquals(chunks[0].includes("datastar-merge-signals"), true);
  });

  await t.step("executeScript broadcasts correctly", async () => {
    const hub = new TransportHub();
    const chunks: string[] = [];
    hub.registerConnection(makeCaptureWriter(chunks));

    hub.executeScript("console.log('hi')");
    await new Promise((r) => setTimeout(r, 0));

    assertEquals(chunks.length, 1);
    assertEquals(chunks[0].includes("datastar-execute-script"), true);
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
});

function makeCaptureWriter(
  chunks: string[],
): WritableStreamDefaultWriter {
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(new TextDecoder().decode(chunk));
    },
  });
  return writable.getWriter();
}
