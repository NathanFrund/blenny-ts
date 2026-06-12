import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import {
  configure,
  getLogger,
  getThrottlingFilter,
  type LogRecord,
  reset as logtapeReset,
} from "@logtape/logtape";
import { BlennyConfig } from "@blenny/core/config.ts";
import {
  createLogger,
  requestLogger,
  resetLogger,
} from "@blenny/core/logger.ts";
import type { BlennyLogger } from "@blenny/core/logger.ts";

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
  await createLogger(new BlennyConfig({ args: ["--log.level=debug"] }));
  const app = new Hono();
  app.use(requestLogger());
  app.get("/test", (c) => c.text("ok"));

  const res = await app.request("http://localhost/test");
  assertEquals(res.status, 200);
  const text = await res.text();
  assertEquals(text, "ok");
  await resetLogger();
});

Deno.test("requestLogger uses warn for 4xx", async () => {
  await createLogger(new BlennyConfig({ args: ["--log.level=debug"] }));
  const app = new Hono();
  app.use(requestLogger());
  app.get("/not-found", (c) => c.text("not found", 404));

  const res = await app.request("http://localhost/not-found");
  assertEquals(res.status, 404);
  await resetLogger();
});

Deno.test("getThrottlingFilter suppresses repeated messages", async () => {
  const captured: LogRecord[] = [];
  const testSink = (record: LogRecord) => {
    captured.push(record);
  };

  const throttleFilter = getThrottlingFilter({ limit: 3, windowMs: 5000 });

  await configure({
    filters: { throttle: throttleFilter },
    sinks: { test: testSink },
    loggers: [{
      category: ["blenny", "throttle-test"],
      sinks: ["test"],
      filters: ["throttle"],
      lowestLevel: "debug",
    }, {
      category: ["logtape", "meta"],
      sinks: ["test"],
      lowestLevel: "warning",
    }],
  });

  const logger = getLogger(["blenny", "throttle-test"]);

  for (let i = 0; i < 10; i++) {
    logger.warn("flood message");
  }

  await new Promise((r) => setTimeout(r, 50));

  assertEquals(captured.length, 3);

  await logtapeReset();
});

Deno.test("throttling resets per unique message pattern", async () => {
  const captured: LogRecord[] = [];
  const testSink = (record: LogRecord) => {
    captured.push(record);
  };

  const throttleFilter = getThrottlingFilter({ limit: 2, windowMs: 5000 });

  await configure({
    filters: { throttle: throttleFilter },
    sinks: { test: testSink },
    loggers: [{
      category: ["blenny", "pattern-test"],
      sinks: ["test"],
      filters: ["throttle"],
      lowestLevel: "debug",
    }, {
      category: ["logtape", "meta"],
      sinks: ["test"],
      lowestLevel: "warning",
    }],
  });

  const logger = getLogger(["blenny", "pattern-test"]);

  for (let i = 0; i < 5; i++) logger.warn("pattern A");
  for (let i = 0; i < 5; i++) logger.warn("pattern B");

  await new Promise((r) => setTimeout(r, 50));

  // Each pattern is throttled independently — 2 from A + 2 from B
  assertEquals(captured.length, 4);

  await logtapeReset();
});

// ── Test-only mock logger ─────────────────────────────────────

interface MockEntry {
  level: string;
  template?: string;
  error?: unknown;
  errorProps?: Record<string, unknown>;
  args: unknown[];
}

class MockLogger implements BlennyLogger {
  entries: MockEntry[] = [];

  debug(template: string, ...args: unknown[]): void {
    this.entries.push({ level: "debug", template, args });
  }
  info(template: string, ...args: unknown[]): void {
    this.entries.push({ level: "info", template, args });
  }
  warn(template: string, ...args: unknown[]): void {
    this.entries.push({ level: "warn", template, args });
  }
  error(template: string, ...args: unknown[]): void;
  error(error: unknown, props?: Record<string, unknown>): void;
  error(templateOrError: string | unknown, ...args: unknown[]): void {
    if (typeof templateOrError === "string") {
      this.entries.push({ level: "error", template: templateOrError, args });
    } else {
      this.entries.push({
        level: "error",
        error: templateOrError,
        errorProps: args[0] as Record<string, unknown> | undefined,
        args: [],
      });
    }
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

Deno.test("MockLogger.error overload stores error and props", () => {
  const logger = new MockLogger();
  const err = new Error("boom");
  logger.error(err, { requestId: "abc" });
  assertEquals(logger.entries.length, 1);
  assertEquals(logger.entries[0].level, "error");
  assertEquals(logger.entries[0].error, err);
  assertEquals(logger.entries[0].errorProps?.requestId, "abc");
});
