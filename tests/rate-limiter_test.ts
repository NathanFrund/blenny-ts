import { assertEquals, assertExists, assertGreaterOrEqual } from "@std/assert";
import { Hono } from "@hono/hono";
import { BlennyConfig } from "../src/core/config.ts";
import { createRateLimiter } from "../src/core/rate-limiter.ts";

function makeConfig(overrides: Record<string, string>): BlennyConfig {
  return new BlennyConfig({
    fileContent: JSON.stringify(overrides),
    env: {},
    args: [],
  });
}

Deno.test("rate limiter", async (t) => {
  await t.step("passes requests under the limit", async () => {
    const config = makeConfig({ "ratelimit.max_requests": "3" });
    const rateLimiter = createRateLimiter(config);
    const app = new Hono();
    app.use("/test", rateLimiter);
    app.get("/test", (c) => c.text("ok"));

    for (let i = 0; i < 3; i++) {
      const res = await app.request("http://localhost/test");
      assertEquals(res.status, 200, `request ${i + 1} should pass`);
    }
  });

  await t.step("blocks requests over the limit with 429", async () => {
    const config = makeConfig({ "ratelimit.max_requests": "2" });
    const rateLimiter = createRateLimiter(config);
    const app = new Hono();
    app.use("/test", rateLimiter);
    app.get("/test", (c) => c.text("ok"));

    for (let i = 0; i < 2; i++) {
      const res = await app.request("http://localhost/test");
      assertEquals(res.status, 200, `request ${i + 1} should pass`);
    }

    const res = await app.request("http://localhost/test");
    assertEquals(res.status, 429);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body, {
      error: { type: "too_many_requests", message: "Too many requests, try again later." },
    });
  });

  await t.step("sets Retry-After header on 429", async () => {
    const config = makeConfig({ "ratelimit.max_requests": "1", "ratelimit.window_ms": "60000" });
    const rateLimiter = createRateLimiter(config);
    const app = new Hono();
    app.use("/test", rateLimiter);
    app.get("/test", (c) => c.text("ok"));

    await app.request("http://localhost/test");
    const res = await app.request("http://localhost/test");
    assertEquals(res.status, 429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    assertExists(retryAfter);
    assertGreaterOrEqual(retryAfter, 55);
  });

  await t.step("tracks different IPs independently", async () => {
    const config = makeConfig({ "ratelimit.max_requests": "1" });
    const rateLimiter = createRateLimiter(config);
    const app = new Hono();
    app.use("/test", rateLimiter);
    app.get("/test", (c) => c.text("ok"));

    const res1 = await app.request("http://localhost/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    assertEquals(res1.status, 200);

    const res2 = await app.request("http://localhost/test", {
      headers: { "x-forwarded-for": "5.6.7.8" },
    });
    assertEquals(res2.status, 200);

    const res3 = await app.request("http://localhost/test", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    assertEquals(res3.status, 429);
  });

  await t.step("window resets after expiry", async () => {
    const config = makeConfig({ "ratelimit.max_requests": "2", "ratelimit.window_ms": "50" });
    const rateLimiter = createRateLimiter(config);
    const app = new Hono();
    app.use("/test", rateLimiter);
    app.get("/test", (c) => c.text("ok"));

    // Exhaust the limit
    await app.request("http://localhost/test");
    await app.request("http://localhost/test");
    const blocked = await app.request("http://localhost/test");
    assertEquals(blocked.status, 429);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    const passed = await app.request("http://localhost/test");
    assertEquals(passed.status, 200);
  });
});
