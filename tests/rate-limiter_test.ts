import {
  assertEquals,
  assertExists,
  assertGreater,
  assertLessOrEqual,
} from "@std/assert";
import { Hono } from "@hono/hono";
import { createRateLimiter } from "@blenny/core/rate-limiter.ts";

Deno.test("rate limiter", async (t) => {
  await t.step("passes requests under the limit", async () => {
    const rateLimiter = createRateLimiter(60_000, 3);
    const app = new Hono();
    app.use("/test", rateLimiter);
    app.get("/test", (c) => c.text("ok"));

    for (let i = 0; i < 3; i++) {
      const res = await app.request("http://localhost/test");
      assertEquals(res.status, 200, `request ${i + 1} should pass`);
    }
  });

  await t.step("blocks requests over the limit with 429", async () => {
    const rateLimiter = createRateLimiter(60_000, 2);
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
      error: {
        type: "too_many_requests",
        message: "Too many requests, try again later.",
      },
    });
  });

  await t.step("sets Retry-After header on 429", async () => {
    const rateLimiter = createRateLimiter(60_000, 1);
    const app = new Hono();
    app.use("/test", rateLimiter);
    app.get("/test", (c) => c.text("ok"));

    await app.request("http://localhost/test");
    const res = await app.request("http://localhost/test");
    assertEquals(res.status, 429);
    const retryAfter = Number(res.headers.get("Retry-After"));
    assertExists(retryAfter);
    assertGreater(retryAfter, 0);
    assertLessOrEqual(retryAfter, 60);
  });

  await t.step("tracks different IPs independently", async () => {
    const rateLimiter = createRateLimiter(60_000, 1, true);
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
    const rateLimiter = createRateLimiter(50, 2);
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

  await t.step(
    "resets count when request crosses window boundary",
    async () => {
      // Use a small window so we can test boundary crossing
      const rateLimiter = createRateLimiter(50, 1);
      const app = new Hono();
      app.use("/test", rateLimiter);
      app.get("/test", (c) => c.text("ok"));

      // First request succeeds
      const res1 = await app.request("http://localhost/test");
      assertEquals(res1.status, 200);

      // Second request in same window is blocked
      const res2 = await app.request("http://localhost/test");
      assertEquals(res2.status, 429);

      // Wait for next window
      await new Promise((r) => setTimeout(r, 60));

      // Now succeeds — count reset because windowIndex changed
      const res3 = await app.request("http://localhost/test");
      assertEquals(res3.status, 200);
    },
  );
});
