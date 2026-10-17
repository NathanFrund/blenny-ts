import { test } from "bun:test";
import { Hono } from "@hono/hono";
import { assertEquals } from "@std/assert";
import indexModule from "../src/modules/index.ts";
import type { HttpMethod } from "../src/types.ts";

test("index module", async () => {
  const app = new Hono();

  for (const route of indexModule.routes) {
    app.on(route.method as HttpMethod, route.path, route.handler);
  }

  await step("GET / returns HTML page", async () => {
    const res = await app.request("http://localhost/");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("blenny-ts"), true);
    assertEquals(html.includes("<!DOCTYPE html>"), true);
    assertEquals(html.includes('<a href="/demo">'), true);
    assertEquals(html.includes('<a href="/task-demo">'), true);
    assertEquals(html.includes('<a href="/dashboard">'), true);
  });
});
