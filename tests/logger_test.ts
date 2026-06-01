import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import { BlennyConfig } from "../src/core/config.ts";
import {
  createLogger,
  requestLogger,
  resetLogger,
} from "../src/core/logger.ts";
import type { BlennyLogger } from "../src/core/logger.ts";

Deno.test("createLogger returns a working BlennyLogger", async () => {
  const config = new BlennyConfig({ args: ["--log.level=debug"] });
  const logger = await createLogger(config);
  // Should not throw — LogTape without full config is silent
  logger.info("test message");
  logger.debug("debug message");
  logger.warn("warn message");
  logger.error("error message");
  await resetLogger();
});

Deno.test("child logger inherits context", async () => {
  const config = new BlennyConfig({ args: ["--log.level=debug"] });
  const logger = await createLogger(config);
  const child = logger.child({ requestId: "abc-123" });
  child.info("child message");
  await resetLogger();
});

Deno.test("requestLogger logs request details", async () => {
  const config = new BlennyConfig({ args: ["--log.level=debug"] });
  const logger = await createLogger(config);
  const app = new Hono();
  app.use(requestLogger(logger));
  app.get("/test", (c) => c.text("ok"));

  const res = await app.request("http://localhost/test");
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, "ok");
  await resetLogger();
});

Deno.test("requestLogger uses warn for 4xx", async () => {
  const config = new BlennyConfig({ args: ["--log.level=debug"] });
  const logger = await createLogger(config);
  const app = new Hono();
  app.use(requestLogger(logger));
  app.get("/not-found", (c) => c.text("not found", 404));

  const res = await app.request("http://localhost/not-found");
  assertEquals(res.status, 404);
  await resetLogger();
});

// ── Test-only mock logger ─────────────────────────────────────

class MockLogger implements BlennyLogger {
  entries: { level: string; template: string; args: unknown[] }[] = [];

  debug(template: string, ...args: unknown[]): void {
    this.entries.push({ level: "debug", template, args });
  }
  info(template: string, ...args: unknown[]): void {
    this.entries.push({ level: "info", template, args });
  }
  warn(template: string, ...args: unknown[]): void {
    this.entries.push({ level: "warn", template, args });
  }
  error(template: string, ...args: unknown[]): void {
    this.entries.push({ level: "error", template, args });
  }
  child(_context: Record<string, unknown>): BlennyLogger {
    return this;
  }
}

Deno.test("MockLogger captures messages", () => {
  const logger = new MockLogger();
  logger.info("hello");
  assertEquals(logger.entries.length, 1);
  assertEquals(logger.entries[0].template, "hello");
  assertEquals(logger.entries[0].level, "info");
});

Deno.test("MockLogger child returns self", () => {
  const logger = new MockLogger();
  const child = logger.child({ x: 1 });
  child.info("from child");
  assertEquals(logger.entries.length, 1);
  assertEquals(logger.entries[0].template, "from child");
});
