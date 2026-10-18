import { test } from "bun:test";
import { fileURLToPath } from "node:url";
import { loadModules } from "@blenny/core/module-loader.ts";
import { assertEquals, assertExists } from "@std/assert";

const modulesDir = fileURLToPath(new URL("../src/modules", import.meta.url));

test("module-loader", async () => {
  await step("loadModules returns modules and failures arrays", async () => {
    const result = await loadModules(modulesDir);
    assertExists(result.modules);
    assertExists(result.failures);
    assertEquals(Array.isArray(result.modules), true);
    assertEquals(Array.isArray(result.failures), true);
  });

  await step("loads known modules from the modules directory", async () => {
    const result = await loadModules(modulesDir);
    const names = result.modules.map((m) => m.name);
    assertEquals(names.includes("index"), true);
    assertEquals(names.includes("demo"), true);
    assertEquals(names.includes("dashboard"), true);
    assertEquals(names.includes("form-auth"), true);
    assertEquals(names.includes("task-demo"), true);
  });

  await step("loaded modules have valid routes", async () => {
    const result = await loadModules(modulesDir);
    for (const mod of result.modules) {
      assertEquals(Array.isArray(mod.routes), true);
      for (const route of mod.routes) {
        assertEquals(typeof route.method, "string");
        assertEquals(typeof route.path, "string");
        assertEquals(typeof route.handler, "function");
      }
    }
  });

  await step("modules may have lifecycle hooks", async () => {
    const result = await loadModules(modulesDir);
    const demo = result.modules.find((m) => m.name === "demo");
    assertExists(demo);
    assertEquals(typeof demo.initialize, "function");
    assertEquals(typeof demo.start, "function");
    assertEquals(typeof demo.stop, "function");

    const formAuthKv = result.modules.find((m) => m.name === "form-auth");
    assertExists(formAuthKv);
    assertEquals(typeof formAuthKv.initialize, "function");

    const formAuthSurreal = result.modules.find((m) => m.name === "form-auth-surreal");
    assertEquals(formAuthSurreal, undefined);
  });

  await step("form-auth declares auth capability", async () => {
    const result = await loadModules(modulesDir);
    const formAuth = result.modules.find((m) => m.name === "form-auth");
    assertExists(formAuth);
    assertExists(formAuth.capabilities);
    assertEquals(formAuth.capabilities!.includes("auth"), true);
  });
});
