import { assertEquals } from "@std/assert";
import demoModule from "../src/modules/demo.ts";
import { TransportHub } from "../src/core/hub.ts";
import { Conduit } from "../src/core/conduit.ts";
import { BlennyConfig } from "../src/core/config.ts";
import { TaskSupervisor } from "../src/core/task-supervisor.ts";
import { Hono } from "@hono/hono";
import type { HttpMethod } from "../src/types.ts";
import { NULL_LOGGER } from "../src/core/logger.ts";

Deno.test("demo module", async (t) => {
  const hub = new TransportHub();
  const conduit = new Conduit();
  const config = new BlennyConfig();
  const app = new Hono();

  await demoModule.initialize?.({
    hub,
    conduit,
    config,
    logger: NULL_LOGGER,
    supervisor: new TaskSupervisor(),
  });

  for (const route of demoModule.routes) {
    app.on(route.method as HttpMethod, route.path, route.handler);
  }

  await t.step("GET /demo returns HTML page", async () => {
    const res = await app.request("http://localhost/demo");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Datastar + WebSocket"), true);
    assertEquals(html.includes("<!doctype html>"), true);
  });

  await t.step("page includes server clock section", async () => {
    const res = await app.request("http://localhost/demo");
    const html = await res.text();
    assertEquals(html.includes("Server clock"), true);
    assertEquals(html.includes("data-signals="), true);
    assertEquals(html.includes('"currentTime"'), true);
    assertEquals(html.includes("data-init"), true);
  });

  await t.step("GET /trigger-broadcast with ui returns JSON", async () => {
    const res = await app.request(
      "http://localhost/trigger-broadcast?category=ui",
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.category, "ui");
  });

  await t.step("GET /trigger-broadcast with data returns JSON", async () => {
    const res = await app.request(
      "http://localhost/trigger-broadcast?category=data",
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.category, "data");
  });

  await t.step("GET /trigger-broadcast with command returns JSON", async () => {
    const res = await app.request(
      "http://localhost/trigger-broadcast?category=command",
    );
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.category, "command");
  });

  await t.step(
    "GET /trigger-broadcast with notification returns JSON",
    async () => {
      const res = await app.request(
        "http://localhost/trigger-broadcast?category=notification",
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.category, "notification");
    },
  );

  await t.step(
    "GET /trigger-broadcast with unknown category returns JSON",
    async () => {
      const res = await app.request(
        "http://localhost/trigger-broadcast?category=none",
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.category, "none");
    },
  );

  await t.step("POST /demo/broadcast accepts JSON body", async () => {
    const res = await app.request("http://localhost/demo/broadcast", {
      method: "POST",
      body: JSON.stringify({ intent: "ui", html: "<div>test</div>" }),
      headers: { "Content-Type": "application/json" },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
  });

  await t.step("start and stop lifecycle are safe", async () => {
    demoModule.start?.();
    await new Promise((r) => setTimeout(r, 100));
    demoModule.stop?.();
  });
});
