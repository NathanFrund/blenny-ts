import { assertEquals } from "@std/assert";
import simulationModule from "../src/modules/simulation.ts";
import { subscribe } from "../src/core/hub.ts";
import { Hono } from "@hono/hono";
import type { HttpMethod } from "../src/types.ts";

Deno.test("simulation module", async (t) => {
  const app = new Hono();

  for (const route of simulationModule.routes) {
    app.on(route.method as HttpMethod, route.path, route.handler);
  }

  await t.step("GET /simulation/status returns JSON", async () => {
    const res = await app.request("http://localhost/simulation/status");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(typeof body.running, "boolean");
    assertEquals(typeof body.currentCycle, "number");
  });

  await t.step("start publishes spatial:tick events", async () => {
    const ticks: unknown[] = [];
    const unsub = subscribe("spatial:tick", (payload) => {
      ticks.push(payload);
    });

    simulationModule.start?.();

    await new Promise((r) => setTimeout(r, 1100));

    simulationModule.stop?.();
    unsub();

    assertEquals(ticks.length >= 1, true);
    const tick = ticks[0] as { cycle: number; activeAgents: number };
    assertEquals(typeof tick.cycle, "number");
    assertEquals(tick.activeAgents, 12);
  });

  await t.step("stop clears the timer", async () => {
    const ticks: unknown[] = [];
    const unsub = subscribe("spatial:tick", (payload) => {
      ticks.push(payload);
    });

    simulationModule.start?.();
    await new Promise((r) => setTimeout(r, 100));
    simulationModule.stop?.();

    const afterStop = ticks.length;
    await new Promise((r) => setTimeout(r, 500));
    assertEquals(ticks.length, afterStop);

    unsub();
  });
});
