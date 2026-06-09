import { assertEquals } from "@std/assert";
import demoModule from "../src/modules/demo/transport.ts";
import { TransportHub } from "@blenny/core/hub.ts";
import { Conduit } from "@blenny/core/conduit.ts";
import { BlennyConfig } from "@blenny/core/config.ts";
import { TaskSupervisor } from "@blenny/core/task-supervisor.ts";
import { Hono } from "@hono/hono";
import type { HttpMethod } from "../src/types.ts";

Deno.test("demo module", async (t) => {
  const hub = new TransportHub();
  const conduit = new Conduit();
  const config = new BlennyConfig();
  const app = new Hono();

  await demoModule.initialize?.({
    hub,
    conduit,
    config,
    supervisor: new TaskSupervisor(),
    startTime: Date.now(),
    version: "0.2.0",
  });

  for (const route of demoModule.routes) {
    app.on(route.method as HttpMethod, route.path, route.handler);
  }

  await t.step("GET /demo returns HTML page", async () => {
    const res = await app.request("http://localhost/demo");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Three-Intent Transport Demo"), true);
    assertEquals(html.includes("<!doctype html>"), true);
  });

  await t.step("page includes server clock section", async () => {
    const res = await app.request("http://localhost/demo");
    const html = await res.text();
    assertEquals(html.includes("Server clock"), true);
    assertEquals(html.includes("data-signals="), true);
    assertEquals(html.includes('"currentTime"'), true);
    assertEquals(html.includes("data-init"), true);
    assertEquals(html.includes("?intent=ui,data,command"), true);
  });

  await t.step("POST /demo/trigger with ui returns JSON", async () => {
    const res = await app.request("http://localhost/demo/trigger", {
      method: "POST",
      body: JSON.stringify({ intent: "ui" }),
      headers: { "Content-Type": "application/json" },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.intent, "ui");
  });

  await t.step("POST /demo/trigger with data returns JSON", async () => {
    const res = await app.request("http://localhost/demo/trigger", {
      method: "POST",
      body: JSON.stringify({ intent: "data" }),
      headers: { "Content-Type": "application/json" },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.intent, "data");
  });

  await t.step("POST /demo/trigger with command returns JSON", async () => {
    const res = await app.request("http://localhost/demo/trigger", {
      method: "POST",
      body: JSON.stringify({ intent: "command" }),
      headers: { "Content-Type": "application/json" },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.intent, "command");
  });

  await t.step("start and stop lifecycle are safe", async () => {
    demoModule.start?.();
    await new Promise((r) => setTimeout(r, 100));
    demoModule.stop?.();
  });
});
