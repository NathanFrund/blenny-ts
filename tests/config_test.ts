import { assertEquals } from "@std/assert";
import { BlennyConfig } from "../src/core/config.ts";

Deno.test("BlennyConfig defaults", async (t) => {
  await t.step("returns embedded default port", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.port, 3000);
  });

  await t.step("returns embedded default bind address", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.bindAddress, "0.0.0.0");
  });

  await t.step("returns embedded default jwt secret", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.jwtSecret, "CHANGE-ME-EMBEDDED-DEFAULT");
  });

  await t.step("returns embedded default session duration", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.sessionDurationHours, 720);
  });

  await t.step("returns embedded default cookie name", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.cookieName, "blenny_session");
  });

  await t.step("returns embedded default dev mode", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.devMode, true);
  });

  await t.step("returns embedded default surreal settings", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.surrealUrl, "ws://127.0.0.1:8000/rpc");
    assertEquals(cfg.surrealNs, "blenny");
    assertEquals(cfg.surrealDb, "blenny");
    assertEquals(cfg.surrealUser, "root");
    assertEquals(cfg.surrealPass, "root");
  });
});

Deno.test("BlennyConfig overrides", async (t) => {
  await t.step("env var overrides default", () => {
    const cfg = new BlennyConfig({
      env: { BLENNY_SERVER_PORT: "8080" },
      args: [],
    });
    assertEquals(cfg.port, 8080);
  });

  await t.step("cli arg overrides env var", () => {
    const cfg = new BlennyConfig({
      env: { BLENNY_SERVER_PORT: "8080" },
      args: ["--server.port=9090"],
    });
    assertEquals(cfg.port, 9090);
  });

  await t.step("file content overrides default", () => {
    const cfg = new BlennyConfig({
      fileContent: JSON.stringify({ "server.port": "5050" }),
      env: {},
      args: [],
    });
    assertEquals(cfg.port, 5050);
  });

  await t.step("env var overrides file", () => {
    const cfg = new BlennyConfig({
      fileContent: JSON.stringify({ "server.port": "5050" }),
      env: { BLENNY_SERVER_PORT: "6060" },
      args: [],
    });
    assertEquals(cfg.port, 6060);
  });

  await t.step("priority order: cli > env > file > default", () => {
    const cfg = new BlennyConfig({
      fileContent: JSON.stringify({ "server.port": "1111" }),
      env: { BLENNY_SERVER_PORT: "2222" },
      args: ["--server.port=3333"],
    });
    assertEquals(cfg.port, 3333);
  });

  await t.step("cli arg without equals sign", () => {
    const cfg = new BlennyConfig({
      env: {},
      args: ["--server.port", "7777"],
    });
    assertEquals(cfg.port, 7777);
  });

  await t.step("cli flag without value sets true", () => {
    const cfg = new BlennyConfig({
      env: {},
      args: ["--dev_mode"],
    });
    assertEquals(cfg.devMode, true);
  });
});

Deno.test("BlennyConfig accessors", async (t) => {
  await t.step("at() returns value for known key", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.at("server.port"), "3000");
  });

  await t.step("at() returns undefined for unknown key", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.at("nope"), undefined);
  });

  await t.step("at() returns env-overridden value", () => {
    const cfg = new BlennyConfig({
      env: { BLENNY_SURREAL_NS: "myapp" },
      args: [],
    });
    assertEquals(cfg.at("surreal.ns"), "myapp");
  });
});

Deno.test("BlennyConfig edge cases", async (t) => {
  await t.step("null fileContent is skipped", () => {
    const cfg = new BlennyConfig({
      fileContent: null,
      env: {},
      args: [],
    });
    assertEquals(cfg.port, 3000);
  });

  await t.step("empty env and args does not crash", () => {
    const cfg = new BlennyConfig({ env: {}, args: [] });
    assertEquals(cfg.port, 3000);
  });

  await t.step("no overrides at all uses real sources", () => {
    // When no overrides provided, reads from real env/args/file.
    // In CI with no env vars set, it should fall back to defaults.
    const cfg = new BlennyConfig();
    assertEquals(typeof cfg.port, "number");
    assertEquals(typeof cfg.jwtSecret, "string");
  });

  await t.step("number in file content is coerced to string", () => {
    const cfg = new BlennyConfig({
      fileContent: JSON.stringify({ "auth.session_duration_hours": 48 }),
      env: {},
      args: [],
    });
    assertEquals(cfg.sessionDurationHours, 48);
  });

  await t.step("boolean in file content is coerced to string", () => {
    const cfg = new BlennyConfig({
      fileContent: JSON.stringify({ "dev_mode": false }),
      env: {},
      args: [],
    });
    assertEquals(cfg.devMode, false);
  });
});
