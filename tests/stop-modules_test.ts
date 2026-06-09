import { assertEquals } from "@std/assert";
import { stopModules } from "@blenny/core/bootstrap/modules.ts";
import type { AppState } from "@blenny/core/app-state.ts";
import type { BlennyModule } from "../src/types.ts";
import { TransportHub } from "@blenny/core/hub.ts";
import { TaskSupervisor } from "@blenny/core/task-supervisor.ts";

Deno.test("stopModules calls all cleanup", async (t) => {
  const hub = new TransportHub();
  const closeAllCalls: string[] = [];
  const stopReaperCalls: string[] = [];

  hub.closeAllConnections = () => closeAllCalls.push("closeAllConnections");
  hub.stopReaper = () => stopReaperCalls.push("stopReaper");

  const stopCalls: string[] = [];
  const moduleA: BlennyModule = {
    name: "mod-a",
    routes: [],
    stop() {
      stopCalls.push("mod-a");
    },
  };
  const moduleB: BlennyModule = {
    name: "mod-b",
    routes: [],
    stop() {
      stopCalls.push("mod-b");
    },
  };

  const dbCloseCalls: string[] = [];
  const state = {
    hub,
    supervisor: new TaskSupervisor(),
    db: {
      close() {
        dbCloseCalls.push("db.close");
      },
    },
  } as unknown as AppState;

  await t.step("calls closeAllConnections", async () => {
    await stopModules([moduleA, moduleB], state);
    assertEquals(closeAllCalls, ["closeAllConnections"]);
  });

  await t.step("calls stopReaper", () => {
    assertEquals(stopReaperCalls, ["stopReaper"]);
  });

  await t.step("calls module stop in reverse order", () => {
    assertEquals(stopCalls, ["mod-b", "mod-a"]);
  });

  await t.step("calls db.close", () => {
    assertEquals(dbCloseCalls, ["db.close"]);
  });
});

Deno.test("stopModules is safe with no db", async () => {
  const hub = new TransportHub();
  hub.closeAllConnections = () => {};
  hub.stopReaper = () => {};

  const state = {
    hub,
    supervisor: new TaskSupervisor(),
  } as unknown as AppState;
  await stopModules([], state);
});

Deno.test("stopModules is safe with no module stop hooks", async () => {
  const hub = new TransportHub();
  hub.closeAllConnections = () => {};
  hub.stopReaper = () => {};

  const mod: BlennyModule = { name: "noop", routes: [] };
  const state = {
    hub,
    supervisor: new TaskSupervisor(),
    db: { async close() {} },
  } as unknown as AppState;
  await stopModules([mod], state);
});
