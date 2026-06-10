import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { createComponentCatalog } from "@blenny/core/component-catalog.ts";
import { TransportHub } from "@blenny/core/hub.ts";
import { Conduit } from "@blenny/core/conduit.ts";
import { BlennyConfig } from "@blenny/core/config.ts";
import { TaskSupervisor } from "@blenny/core/task-supervisor.ts";
import authModule from "../src/modules/auth/.form-auth-kv/index.ts";
import userAdminModule from "../src/modules/auth/user-admin/index.tsx";
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

async function buildApp(): Promise<{ app: Hono; state: AppState }> {
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
  await userAdminModule.initialize?.(state);

  if (state.auth) {
    app.use("*", state.auth.middleware);
  }

  for (const route of authModule.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    app.on(method, route.path, handler);
  }

  for (const route of userAdminModule.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    const guard: MiddlewareHandler = typeof route.auth === "string"
      ? state.auth!.requireRole(route.auth)
      : state.auth!.requireUser;
    app.on(method, route.path, guard, handler);
  }

  return { app, state };
}

Deno.test("user-admin", async (t) => {
  const { app, state } = await buildApp();

  await t.step("GET without auth redirects to sign-in", async () => {
    const res = await app.request("http://localhost/admin/users");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/signin");
  });

  await t.step("GET as non-admin user returns 403", async () => {
    const regBody = buildBody({
      username: "regular-user",
      display_name: "Regular",
      password: "secret123",
    });
    await app.request("http://localhost/auth/register", {
      method: "POST",
      body: regBody.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const userCookie = await signInAs(app, "regular-user", "secret123");

    const res = await app.request("http://localhost/admin/users", {
      headers: { Cookie: userCookie },
    });
    assertEquals(res.status, 403);
    assertEquals(await res.json(), {
      error: "forbidden",
      message: "Insufficient role",
    });
  });

  await t.step("GET as admin shows user table", async () => {
    const cookie = await signInAs(app, "admin", "admin");
    const res = await app.request("http://localhost/admin/users", {
      headers: { Cookie: cookie },
    });
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("User Administration"), true);
    assertEquals(html.includes("admin"), true);
    assertEquals(html.includes("Administrator"), true);
  });

  await t.step("POST update role changes user role", async () => {
    const admin = await state.store!.findByUsername("admin") as NonNullable<
      Awaited<ReturnType<NonNullable<AppState["store"]>["findByUsername"]>>
    >;
    const cookie = await signInAs(app, "admin", "admin");

    const body = buildBody({ role: "user" });
    const res = await app.request(
      `http://localhost/admin/users/${admin.id}/role`,
      {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookie,
        },
      },
    );
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/admin/users");

    const updated = await state.store!.findById(admin.id);
    assertEquals(updated?.role, "user");

    // Restore admin role for subsequent tests
    await state.store!.updateRole(admin.id, "admin");
  });

  await t.step("POST delete user removes user", async () => {
    const regBody = buildBody({
      username: "delete-me-user",
      display_name: "Delete Me",
      password: "secret123",
    });
    await app.request("http://localhost/auth/register", {
      method: "POST",
      body: regBody.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const target = await state.store!.findByUsername(
      "delete-me-user",
    ) as NonNullable<
      Awaited<ReturnType<NonNullable<AppState["store"]>["findByUsername"]>>
    >;
    const cookie = await signInAs(app, "admin", "admin");

    const res = await app.request(
      `http://localhost/admin/users/${target.id}/delete`,
      {
        method: "POST",
        headers: { Cookie: cookie },
      },
    );
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/admin/users");

    const gone = await state.store!.findById(target.id);
    assertEquals(gone, null);
  });

  await t.step("POST delete nonexistent user is safe", async () => {
    const cookie = await signInAs(app, "admin", "admin");
    const res = await app.request(
      `http://localhost/admin/users/nonexistent-id/delete`,
      {
        method: "POST",
        headers: { Cookie: cookie },
      },
    );
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/admin/users");
  });
});
