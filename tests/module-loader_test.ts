import { assertEquals, assertExists } from "@std/assert";
import { loadModules } from "../src/core/module-loader.ts";

Deno.test("module-loader", async (t) => {
  await t.step("loadModules returns modules and failures arrays", async () => {
    const result = await loadModules();
    assertExists(result.modules);
    assertExists(result.failures);
    assertEquals(Array.isArray(result.modules), true);
    assertEquals(Array.isArray(result.failures), true);
  });

  await t.step("loads known modules from the modules directory", async () => {
    const result = await loadModules();
    const names = result.modules.map((m) => m.name);
    assertEquals(names.includes("index"), true);
    assertEquals(names.includes("demo"), true);
    assertEquals(names.includes("dashboard"), true);
    assertEquals(names.includes("form-auth"), true);
  });

  await t.step("loaded modules have valid routes", async () => {
    const result = await loadModules();
    for (const mod of result.modules) {
      assertEquals(Array.isArray(mod.routes), true);
      for (const route of mod.routes) {
        assertEquals(typeof route.method, "string");
        assertEquals(typeof route.path, "string");
        assertEquals(typeof route.handler, "function");
      }
    }
  });

  await t.step("modules may have lifecycle hooks", async () => {
    const result = await loadModules();
    const demo = result.modules.find((m) => m.name === "demo");
    assertExists(demo);
    assertEquals(typeof demo.initialize, "function");
    assertEquals(typeof demo.start, "function");
    assertEquals(typeof demo.stop, "function");

    const formAuth = result.modules.find((m) => m.name === "form-auth");
    assertExists(formAuth);
    assertEquals(typeof formAuth.initialize, "function");
  });

  await t.step("form-auth declares auth capability", async () => {
    const result = await loadModules();
    const formAuth = result.modules.find((m) => m.name === "form-auth");
    assertExists(formAuth);
    assertExists(formAuth.capabilities);
    assertEquals(formAuth.capabilities!.includes("auth"), true);
  });
});
