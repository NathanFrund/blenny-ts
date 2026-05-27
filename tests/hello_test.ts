import { assertEquals } from "@std/assert";
import helloModule from "../src/modules/hello.ts";
import { Hono } from "@hono/hono";
import type { HttpMethod } from "../src/types.ts";

Deno.test("hello module", async (t) => {
  const app = new Hono();

  for (const route of helloModule.routes) {
    app.on(route.method as HttpMethod, route.path, route.handler);
  }

  await t.step("GET / returns HTML page", async () => {
    const res = await app.request("http://localhost/");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("blenny-ts"), true);
    assertEquals(html.includes("<!DOCTYPE html>"), true);
    assertEquals(html.includes("EventSource"), true);
  });

  await t.step("GET /hello returns text", async () => {
    const res = await app.request("http://localhost/hello");
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "hello from blenny-ts");
  });
});
