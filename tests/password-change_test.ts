import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { createComponentCatalog } from "@blenny/core/component-catalog.ts";
import { TransportHub } from "@blenny/core/hub.ts";
import { Conduit } from "@blenny/core/conduit.ts";
import { BlennyConfig } from "@blenny/core/config.ts";
import { TaskSupervisor } from "@blenny/core/task-supervisor.ts";
import authModule from "../src/modules/auth/.form-auth-kv/index.ts";
import passwordChangeModule from "../src/modules/auth/password-change.tsx";
import type { AppState } from "@blenny/core/app-state.ts";
import type { HttpMethod } from "../src/types.ts";

function buildBody(base: Record<string, string>): URLSearchParams {
  return new URLSearchParams(base);
}

function extractCookieName(setCookie: string): string {
  const match = setCookie.match(/^([^=]+=[^;]+)/);
  return match ? match[1] : "";
}

async function signInAs(
  app: Hono,
  username: string,
  password: string,
): Promise<string> {
  const body = buildBody({ username, password });
  const res = await app.request("http://localhost/auth/signin", {
    method: "POST",
    body: body.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  const cookie = res.headers.get("set-cookie");
  return cookie ? extractCookieName(cookie) : "";
}

function formRequest(
  path: string,
  fields: Record<string, string>,
  cookie?: string,
): Request {
  const body = buildBody(fields);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (cookie) headers["Cookie"] = cookie;
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: body.toString(),
    headers,
  });
}

async function buildApp(): Promise<Hono> {
  const config = new BlennyConfig();
  const hub = new TransportHub();
  const conduit = new Conduit();
  const state: AppState = {
    hub,
    conduit,
    config,
    supervisor: new TaskSupervisor(),
    components: createComponentCatalog(),
    startTime: Date.now(),
    version: "0.2.0",
  };
  const app = new Hono();

  await authModule.initialize?.(state);
  await passwordChangeModule.initialize?.(state);

  if (state.auth) {
    app.use("*", state.auth.middleware);
  }

  for (const route of authModule.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    app.on(method, route.path, handler);
  }

  for (const route of passwordChangeModule.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    const guard: MiddlewareHandler = typeof route.auth === "string"
      ? state.auth!.requireRole(route.auth)
      : state.auth!.requireUser;
    app.on(method, route.path, guard, handler);
  }

  return app;
}

Deno.test("password-change", async (t) => {
  const app = await buildApp();

  await t.step("GET without auth redirects to sign-in", async () => {
    const res = await app.request("http://localhost/auth/change-password");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/signin");
  });

  await t.step("GET with auth renders form", async () => {
    const cookie = await signInAs(app, "admin", "admin");
    const res = await app.request("http://localhost/auth/change-password", {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Change Password"), true);
    assertEquals(html.includes('name="currentPassword"'), true);
    assertEquals(html.includes('name="newPassword"'), true);
    assertEquals(html.includes('name="confirmPassword"'), true);
  });

  await t.step("POST passwords do not match shows error", async () => {
    const cookie = await signInAs(app, "admin", "admin");
    const res = await app.request(formRequest(
      "/auth/change-password",
      {
        currentPassword: "admin",
        newPassword: "abc12345",
        confirmPassword: "different",
      },
      cookie,
    ));
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Passwords do not match"), true);
  });

  await t.step("POST password too short shows error", async () => {
    const cookie = await signInAs(app, "admin", "admin");
    const res = await app.request(formRequest(
      "/auth/change-password",
      {
        currentPassword: "admin",
        newPassword: "short",
        confirmPassword: "short",
      },
      cookie,
    ));
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Password must be at least 8 characters"), true);
  });

  await t.step("POST wrong current password shows error", async () => {
    const cookie = await signInAs(app, "admin", "admin");
    const res = await app.request(formRequest(
      "/auth/change-password",
      {
        currentPassword: "wrongpass",
        newPassword: "abc12345",
        confirmPassword: "abc12345",
      },
      cookie,
    ));
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Current password is incorrect"), true);
  });

  await t.step("POST success changes password", async () => {
    const cookie = await signInAs(app, "admin", "admin");
    const res = await app.request(formRequest(
      "/auth/change-password",
      {
        currentPassword: "admin",
        newPassword: "newpass123",
        confirmPassword: "newpass123",
      },
      cookie,
    ));
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Password changed successfully"), true);
  });

  await t.step("POST without auth redirects to sign-in", async () => {
    const res = await app.request(formRequest(
      "/auth/change-password",
      {
        currentPassword: "admin",
        newPassword: "abc12345",
        confirmPassword: "abc12345",
      },
    ));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/signin");
  });
});
