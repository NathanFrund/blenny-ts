import { assertEquals, assertExists } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { TransportHub } from "../src/core/hub.ts";
import { Conduit } from "../src/core/conduit.ts";
import { BlennyConfig } from "../src/core/config.ts";
import { TaskSupervisor } from "../src/core/task-supervisor.ts";
import authModule from "../src/modules/form-auth/index.ts";
import type { AppState } from "../src/core/app-state.ts";
import type { HttpMethod } from "../src/types.ts";
import { NULL_LOGGER } from "../src/core/logger.ts";

async function buildApp(): Promise<Hono> {
  const config = new BlennyConfig();
  const hub = new TransportHub();
  const conduit = new Conduit();
  const state: AppState = { hub, conduit, config, logger: NULL_LOGGER, supervisor: new TaskSupervisor() };
  const app = new Hono();

  await authModule.initialize?.(state);

  if (state.auth) {
    app.use("*", state.auth.middleware);
  }

  for (const route of authModule.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    app.on(method, route.path, handler);
  }

  // Add a protected route to test auth guard
  app.get("/protected", state.auth!.requireUser, (c) => c.text("inside"));

  return app;
}

/** Make a GET request to a form page to extract a CSRF token + cookie header. */
async function obtainCsrfToken(
  app: Hono,
  path: string = "/auth/signin",
): Promise<{ token: string; cookieHeader: string }> {
  const res = await app.request(`http://localhost${path}`);
  const setCookie = res.headers.get("set-cookie")!;
  const match = setCookie.match(/csrf=([^;]+)/);
  assertExists(match);
  return { token: match[1], cookieHeader: `csrf=${match[1]}` };
}

function csrfBody(
  base: Record<string, string>,
  token: string,
): URLSearchParams {
  return new URLSearchParams({ ...base, _csrf: token });
}

Deno.test("form-auth module", async (t) => {
  const app = await buildApp();

  await t.step("GET /auth/signin returns sign-in form", async () => {
    const res = await app.request("http://localhost/auth/signin");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Sign In"), true);
    assertEquals(html.includes('<form method="post"'), true);
    assertEquals(html.includes('name="_csrf"'), true);
    assertEquals(html.includes('name="username"'), true);
    assertEquals(html.includes('name="password"'), true);
  });

  await t.step("POST /auth/signin with bad creds shows error", async () => {
    const { token, cookieHeader } = await obtainCsrfToken(app);
    const body = csrfBody({ username: "bad", password: "wrong" }, token);
    const res = await app.request("http://localhost/auth/signin", {
      method: "POST",
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
      },
    });
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Invalid username or password"), true);
  });

  await t.step(
    "POST /auth/signin with admin/admin returns 302 + cookie",
    async () => {
      const { token, cookieHeader } = await obtainCsrfToken(app);
      const body = csrfBody({ username: "admin", password: "admin" }, token);
      const res = await app.request("http://localhost/auth/signin", {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader,
        },
      });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get("location"), "/dashboard");

      const setCookie = res.headers.get("set-cookie");
      assertExists(setCookie);
      assertEquals(setCookie.includes("blenny_session"), true);
      assertEquals(setCookie.includes("HttpOnly"), true);
    },
  );

  await t.step("authenticated request passes requireUser guard", async () => {
    // First sign in to get the cookie (with CSRF)
    const { token, cookieHeader } = await obtainCsrfToken(app);
    const body = csrfBody({ username: "admin", password: "admin" }, token);
    const signinRes = await app.request("http://localhost/auth/signin", {
      method: "POST",
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
      },
    });
    const sessionCookie = signinRes.headers.get("set-cookie")!;

    // Now access protected route with the session cookie
    const res = await app.request("http://localhost/protected", {
      headers: { Cookie: extractCookieName(sessionCookie) },
    });
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "inside");
  });

  await t.step("POST /auth/signout clears cookie", async () => {
    const { token, cookieHeader } = await obtainCsrfToken(app);
    const body = csrfBody({}, token);
    const res = await app.request("http://localhost/auth/signout", {
      method: "POST",
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
      },
    });
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/");

    const setCookie = res.headers.get("set-cookie");
    assertExists(setCookie);
    assertEquals(setCookie.includes("blenny_session=;"), true);
    assertEquals(setCookie.includes("Max-Age=0"), true);
  });
});

Deno.test("registration", async (t) => {
  const app = await buildApp();

  await t.step("GET /auth/register returns registration form", async () => {
    const res = await app.request("http://localhost/auth/register");
    assertEquals(res.status, 200);
    const html = await res.text();
    assertEquals(html.includes("Register"), true);
    assertEquals(html.includes('name="_csrf"'), true);
    assertEquals(html.includes('name="username"'), true);
    assertEquals(html.includes('name="display_name"'), true);
    assertEquals(html.includes('name="password"'), true);
    assertEquals(html.includes('/auth/signin"'), true);
  });

  await t.step(
    "POST /auth/register creates user and returns 302 + cookie",
    async () => {
      const { token, cookieHeader } = await obtainCsrfToken(app, "/auth/register");
      const body = csrfBody({
        username: "regtest-user",
        display_name: "Reg User",
        password: "secret123",
      }, token);
      const res = await app.request("http://localhost/auth/register", {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader,
        },
      });
      assertEquals(res.status, 302);
      assertEquals(res.headers.get("location"), "/dashboard");

      const setCookie = res.headers.get("set-cookie");
      assertExists(setCookie);
      assertEquals(setCookie.includes("blenny_session"), true);
      assertEquals(setCookie.includes("HttpOnly"), true);
    },
  );

  await t.step(
    "POST /auth/register with taken username shows error",
    async () => {
      const { token, cookieHeader } = await obtainCsrfToken(app, "/auth/register");
      const body = csrfBody({
        username: "admin",
        display_name: "Should Fail",
        password: "whatever",
      }, token);
      const res = await app.request("http://localhost/auth/register", {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader,
        },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      assertEquals(html.includes("Username is already taken"), true);
    },
  );

  await t.step(
    "POST /auth/register with empty fields shows error",
    async () => {
      const { token, cookieHeader } = await obtainCsrfToken(app, "/auth/register");
      const body = csrfBody({
        username: "",
        display_name: "",
        password: "",
      }, token);
      const res = await app.request("http://localhost/auth/register", {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader,
        },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      assertEquals(html.includes("Username is required"), true);
    },
  );

  await t.step(
    "POST /auth/register with short password shows error",
    async () => {
      const { token, cookieHeader } = await obtainCsrfToken(app, "/auth/register");
      const body = csrfBody({
        username: "validuser",
        display_name: "Valid User",
        password: "short",
      }, token);
      const res = await app.request("http://localhost/auth/register", {
        method: "POST",
        body: body.toString(),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: cookieHeader,
        },
      });
      assertEquals(res.status, 200);
      const html = await res.text();
      assertEquals(
        html.includes("Password must be at least 8 characters"),
        true,
      );
    },
  );

  await t.step("newly registered user can sign in", async () => {
    const { token, cookieHeader } = await obtainCsrfToken(app);
    const body = csrfBody({
      username: "regtest-user",
      password: "secret123",
    }, token);
    const res = await app.request("http://localhost/auth/signin", {
      method: "POST",
      body: body.toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
      },
    });
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/dashboard");
    assertExists(res.headers.get("set-cookie"));
  });
});

Deno.test("lifecycle", async (t) => {
  await t.step("stop is a no-op in memory mode", async () => {
    const config = new BlennyConfig();
    const hub = new TransportHub();
    const conduit = new Conduit();
    const state: AppState = { hub, conduit, config, logger: NULL_LOGGER, supervisor: new TaskSupervisor() };

    await authModule.initialize?.(state);
    await authModule.stop?.();
  });

  await t.step("stop closes the KV connection cleanly", async () => {
    const config = new BlennyConfig({
      fileContent: JSON.stringify({
        "form-auth.store": "kv",
        "form-auth.db.path": ":memory:",
      }),
    });
    const hub = new TransportHub();
    const conduit = new Conduit();
    const state: AppState = { hub, conduit, config, logger: NULL_LOGGER, supervisor: new TaskSupervisor() };

    await authModule.initialize?.(state);
    await authModule.stop?.();
  });
});

function extractCookieName(setCookie: string): string {
  const match = setCookie.match(/^([^=]+=[^;]+)/);
  return match ? match[1] : "";
}
