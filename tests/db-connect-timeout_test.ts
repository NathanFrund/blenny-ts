import { test } from "bun:test";
import { BlennyConfig } from "@blenny/core/config.ts";
import { connectDatabase } from "@blenny/core/database.ts";
import { SurrealConnectionManager, withTimeout } from "@blenny/core/db-manager.ts";
import { assertEquals, assertRejects } from "@std/assert";

/** A TCP listener that accepts connections but never speaks, so a WS handshake hangs. */
function silentServer() {
  return Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {},
      data() {},
      close() {},
      drain() {},
      error() {},
    },
  });
}

function timeoutConfig(port: number, timeoutMs: number): BlennyConfig {
  return new BlennyConfig({
    fileContent: JSON.stringify({
      "surreal.url": `ws://127.0.0.1:${port}/rpc`,
      "surreal.connect_timeout_ms": String(timeoutMs),
    }),
    env: {},
    args: [],
  });
}

test("withTimeout", async () => {
  await step("rejects after the deadline when the promise never settles", async () => {
    const start = Date.now();
    const err = (await assertRejects(() => withTimeout(new Promise<never>(() => {}), 50))) as Error;
    const elapsed = Date.now() - start;

    assertEquals(elapsed >= 40, true);
    assertEquals(err instanceof Error, true);
    assertEquals(/timed out/i.test(err.message), true);
  });

  await step("invokes onTimeout when the deadline fires", async () => {
    let called = false;
    await assertRejects(() => withTimeout(new Promise<never>(() => {}), 30, () => (called = true)));
    assertEquals(called, true);
  });

  await step("resolves when the promise settles first", async () => {
    const value = await withTimeout(Promise.resolve("ok"), 1000);
    assertEquals(value, "ok");
  });

  await step("propagates the original rejection", async () => {
    const err = (await assertRejects(() => withTimeout(Promise.reject(new Error("boom")), 1000))) as Error;
    assertEquals(err.message, "boom");
  });
});

test("SurrealDB connect timeout", async () => {
  const server = silentServer();
  const port = server.port;
  try {
    await step("connect() rejects within the budget against a silent server", async () => {
      const mgr = new SurrealConnectionManager(timeoutConfig(port, 150));
      const start = Date.now();
      const err = (await assertRejects(() => mgr.connect())) as Error;
      const elapsed = Date.now() - start;

      assertEquals(elapsed < 2000, true);
      assertEquals(/timed out/i.test(err.message), true);
      assertEquals(mgr.connected, false);
      await mgr.close();
    });

    await step("connectDatabase() returns null instead of hanging", async () => {
      const start = Date.now();
      const db = await connectDatabase(timeoutConfig(port, 150));
      const elapsed = Date.now() - start;

      assertEquals(db, null);
      assertEquals(elapsed < 2000, true);
    });
  } finally {
    server.stop(true);
  }
});
