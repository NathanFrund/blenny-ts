import { assertEquals, assertExists } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { TransportHub } from "../src/core/hub.ts";
import { Conduit } from "../src/core/conduit.ts";
import { BlennyConfig } from "../src/core/config.ts";
import authModule from "../src/modules/form-auth.tsx";
import type { AppState } from "../src/core/app-state.ts";

function buildApp(): Hono {
  const config = new BlennyConfig();
  const hub = new TransportHub();
  const conduit = new Conduit();
  const state: AppState = { hub, conduit, config };
  const app = new Hono();

  authModule.initialize?.(state);

  if (state.auth) {
    app.use("*", state.auth.middleware);
  }

  for (const route of authModule.routes) {
    const method = route.method as "GET" | "POST" | "PUT" | "DELETE";
    const handler = route.handler as unknown as MiddlewareHandler;
    app.on(method, route.path, handler);
  }

  // Add a protected route to test auth guard
  app.get("/protected", state.auth!.requireUser, (c) => c.text("inside"));

  return app;
}

Deno.test("form-auth module", async (t) => {
  const app = buildApp();

  await t.step("GET /auth/signin returns sign-in form", async () => {
    const res = await app.request("http://localhost/auth/signin");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Sign In"), true);
    assertEquals(html.includes('<form method="post"'), true);
    assertEquals(html.includes('name="username"'), true);
    assertEquals(html.includes('name="password"'), true);
  });

  await t.step("POST /auth/signin with bad creds shows error", async () => {
    const body = new URLSearchParams({ username: "bad", password: "wrong" });
    const res = await app.request("http://localhost/auth/signin", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Invalid username or password"), true);
  });

  await t.step("POST /auth/signin with admin/admin returns 302 + cookie", async () => {
    const body = new URLSearchParams({ username: "admin", password: "admin" });
    const res = await app.request("http://localhost/auth/signin", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/dashboard");

    const setCookie = res.headers.get("set-cookie");
    assertExists(setCookie);
    assertEquals(setCookie.includes("blenny_session"), true);
    assertEquals(setCookie.includes("HttpOnly"), true);
  });

  await t.step("authenticated request passes requireUser guard", async () => {
    // First sign in to get the cookie
    const body = new URLSearchParams({ username: "admin", password: "admin" });
    const signinRes = await app.request("http://localhost/auth/signin", {
      method: "POST",
      body: body.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const cookie = signinRes.headers.get("set-cookie")!;

    // Now access protected route with the cookie
    const res = await app.request("http://localhost/protected", {
      headers: { Cookie: extractCookieName(cookie) },
    });
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "inside");
  });

  await t.step("POST /auth/signout clears cookie", async () => {
    const res = await app.request("http://localhost/auth/signout", {
      method: "POST",
    });
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/");

    const setCookie = res.headers.get("set-cookie");
    assertExists(setCookie);
    assertEquals(setCookie.includes("blenny_session=;"), true);
    assertEquals(setCookie.includes("Max-Age=0"), true);
  });
});

function extractCookieName(setCookie: string): string {
  const match = setCookie.match(/^([^=]+=[^;]+)/);
  return match ? match[1] : "";
}
