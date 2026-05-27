import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import { createRequestSizeLimit } from "../src/core/request-size.ts";

Deno.test("request size limit", async (t) => {
  await t.step("passes request under the limit", async () => {
    const limit = createRequestSizeLimit(1024);
    const app = new Hono();
    app.use("*", limit);
    app.post("/test", (c) => c.text("ok"));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "500" },
      body: "x".repeat(500),
    });
    assertEquals(res.status, 200);
  });

  await t.step("rejects request over the limit with 413", async () => {
    const limit = createRequestSizeLimit(100);
    const app = new Hono();
    app.use("*", limit);
    app.post("/test", (c) => c.text("ok"));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "200" },
      body: "x".repeat(200),
    });
    assertEquals(res.status, 413);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body, {
      error: { type: "request_too_large", message: "Request body too large" },
    });
  });

  await t.step("passes request without content-length header", async () => {
    const limit = createRequestSizeLimit(100);
    const app = new Hono();
    app.use("*", limit);
    app.post("/test", (c) => c.text("ok"));

    const res = await app.request("http://localhost/test", {
      method: "POST",
      body: "hello",
    });
    assertEquals(res.status, 200);
  });
});
