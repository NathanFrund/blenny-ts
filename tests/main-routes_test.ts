import { assertEquals, assertExists } from "@std/assert";
import { Hono } from "@hono/hono";
import { TransportHub } from "../src/core/hub.ts";
import { Conduit } from "../src/core/conduit.ts";
import { BlennyConfig } from "../src/core/config.ts";
import { TaskSupervisor } from "../src/core/task-supervisor.ts";
import { getUser } from "../src/core/auth.ts";
import type { AppState } from "../src/core/app-state.ts";
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { SseConnection } from "../src/core/sse-connection.ts";
import { registerPlatformEndpoints } from "../src/core/bootstrap/endpoints.ts";
import {
  applyAuthMiddleware,
  registerModuleRoutes,
} from "../src/core/bootstrap/modules.ts";

Deno.test("main routes", async (t) => {
  const config = new BlennyConfig();
  const hub = new TransportHub();
  const conduit = new Conduit();
  const state: AppState = {
    hub,
    conduit,
    config,
    supervisor: new TaskSupervisor(),
  };
  const app = new Hono();

  // Replicates main.ts bootstrap pipeline for endpoints-only test
  const authModule = await import("../src/modules/form-auth-kv/index.ts");
  await authModule.default.initialize?.(state);
  applyAuthMiddleware(app, state);
  const dashboardModule = await import("../src/modules/dashboard.tsx");
  await dashboardModule.default.initialize?.(state);
  registerModuleRoutes(app, [dashboardModule.default], state);
  registerPlatformEndpoints(app, state, config);

  await t.step("GET /health returns JSON with module count", async () => {
    const res = await app.request("http://localhost/health");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ok");
    assertEquals(typeof body.modules, "number");
  });

  await t.step(
    "GET /sse without auth returns 401 when auth required",
    async () => {
      const authConfig = { ...state.auth!.config };
      authConfig.allowQueryToken = true;
      const appAuth = new Hono();
      appAuth.get("/sse", async (c) => {
        const user = await getUser(c, authConfig);
        if (user) {
          return ServerSentEventGenerator.stream(
            (stream) => {
              const id = crypto.randomUUID();
              const conn = new SseConnection(stream, id, user.id);
              const cleanup = hub.registerConnection(conn);
              return new Promise<void>((resolve) => {
                c.req.raw.signal.addEventListener("abort", () => {
                  cleanup();
                  resolve();
                });
              });
            },
            { keepalive: true },
          );
        }
        return c.text("Unauthorized", 401);
      });
      const res = await appAuth.request("http://localhost/sse");
      assertEquals(res.status, 401);
    },
  );

  await t.step(
    "GET /sse with valid token returns SSE content-type",
    async () => {
      const { createToken } = await import("../src/core/auth.ts");
      const token = await createToken(
        { id: "admin", role: "admin" },
        state.auth!.config,
      );
      const res = await app.request("http://localhost/sse", {
        headers: { Cookie: "blenny_session=" + token },
      });
      assertEquals(res.status, 200);
      const ctype = res.headers.get("content-type");
      assertExists(ctype);
      assertEquals(ctype.includes("text/event-stream"), true);
      assertEquals(res.headers.get("cache-control"), "no-cache");
    },
  );

  await t.step(
    "GET /dashboard (no auth) redirects to /auth/signin",
    async () => {
      const res = await app.request("http://localhost/dashboard");
      assertEquals(res.status, 302);
      assertEquals(res.headers.get("location"), "/auth/signin");
    },
  );

  await t.step("GET /sse with token and intent works", async () => {
    const { createToken } = await import("../src/core/auth.ts");
    const token = await createToken(
      { id: "admin", role: "admin" },
      state.auth!.config,
    );
    const res = await app.request("http://localhost/sse?intent=ui", {
      headers: { Cookie: "blenny_session=" + token },
    });
    assertEquals(res.status, 200);
  });

  await t.step(
    "GET /sse with token creates authenticated connection",
    async () => {
      const { createToken } = await import("../src/core/auth.ts");
      const token = await createToken(
        { id: "admin", role: "admin" },
        state.auth!.config,
      );
      const res = await app.request("http://localhost/sse", {
        headers: { Cookie: "blenny_session=" + token },
      });
      assertEquals(res.status, 200);
    },
  );
});
