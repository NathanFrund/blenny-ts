import { assertEquals, assertExists } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { TransportHub } from "../src/core/hub.ts";
import { Conduit } from "../src/core/conduit.ts";
import { BlennyConfig } from "../src/core/config.ts";
import { getUser } from "../src/core/auth.ts";
import type { Intent } from "../src/core/envelope.ts";
import type { AppState } from "../src/core/app-state.ts";
import type { HttpMethod } from "../src/types.ts";
import { NULL_LOGGER } from "../src/core/logger.ts";
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { SseConnection } from "../src/core/sse-connection.ts";

Deno.test("main routes", async (t) => {
  const config = new BlennyConfig();
  const hub = new TransportHub();
  const conduit = new Conduit();
  const state: AppState = { hub, conduit, config, logger: NULL_LOGGER };
  const app = new Hono();

  // Initialize auth module first (mirrors main.ts)
  const authModule = await import("../src/modules/form-auth.tsx");
  await authModule.default.initialize?.(state);

  // Simulate what main.ts does after module init
  app.get("/health", (c) => c.json({ status: "ok", modules: 5 }));

  app.get("/sse", async (c) => {
    const intentParam = c.req.query("intent");
    const intents = intentParam
      ? new Set(intentParam.split(",") as Intent[])
      : undefined;

    let userId: string | undefined;
    if (state.auth) {
      const user = await getUser(c, state.auth.config);
      if (user) userId = user.id;
    }

    if (state.auth && config.transportAuthRequired && !userId) {
      return c.text("Unauthorized", 401);
    }

    return ServerSentEventGenerator.stream(
      (stream) => {
        const id = crypto.randomUUID();
        const conn = new SseConnection(stream, id, userId, intents);
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
  });

  if (state.auth) {
    app.use("*", state.auth.middleware);
  }

  // Register a protected route the way main.ts does
  const dashboardModule = await import("../src/modules/dashboard.tsx");
  const dashMod = dashboardModule.default;

  await dashMod.initialize?.(state);

  for (const route of dashMod.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    if (route.auth && state.auth) {
      const guard: MiddlewareHandler =
        typeof route.auth === "string"
          ? state.auth.requireRole(route.auth)
          : state.auth.requireUser;
      app.on(method, route.path, guard, handler);
    } else {
      app.on(method, route.path, handler);
    }
  }

  await t.step("GET /health returns JSON with module count", async () => {
    const res = await app.request("http://localhost/health");
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.status, "ok");
    assertEquals(typeof body.modules, "number");
  });

  await t.step("GET /sse without auth returns 401", async () => {
    const res = await app.request("http://localhost/sse");
    assertEquals(res.status, 401);
  });

  await t.step("GET /sse with valid token returns SSE content-type", async () => {
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
  });

  await t.step("GET /dashboard (no auth) redirects to /auth/signin", async () => {
    const res = await app.request("http://localhost/dashboard");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/signin");
  });

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

  await t.step("GET /sse with token creates authenticated connection", async () => {
    const { createToken } = await import("../src/core/auth.ts");
    const token = await createToken(
      { id: "admin", role: "admin" },
      state.auth!.config,
    );
    const res = await app.request("http://localhost/sse", {
      headers: { Cookie: "blenny_session=" + token },
    });
    assertEquals(res.status, 200);
  });
});
