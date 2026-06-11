import { assertEquals, assertExists } from "@std/assert";
import { Context, Hono } from "@hono/hono";
import {
  clearSessionCookie,
  createAuthMiddleware,
  createToken,
  getUser,
  hasRole,
  requireRole,
  requireUser,
  setSessionCookie,
} from "@blenny/core/auth.ts";
import type { AuthConfig } from "@blenny/core/auth.ts";

const config: AuthConfig = {
  jwtSecret: "test-secret",
  cookieName: "test_session",
  sessionExpiry: 3600,
};

const adminUser = { id: "admin", role: "admin" };

Deno.test("hasRole", async (t) => {
  await t.step("returns false for undefined user", () => {
    assertEquals(hasRole("admin")(undefined), false);
  });

  await t.step("checks singular role", () => {
    assertEquals(hasRole("admin")({ id: "1", role: "admin" }), true);
    assertEquals(hasRole("admin")({ id: "1", role: "user" }), false);
  });

  await t.step("checks roles array", () => {
    assertEquals(
      hasRole("commander")({ id: "1", role: "user", roles: ["commander"] }),
      true,
    );
    assertEquals(
      hasRole("commander")({ id: "1", role: "user", roles: ["admin"] }),
      false,
    );
  });

  await t.step("checks effectiveRoles", () => {
    assertEquals(
      hasRole("commander")(
        { id: "1", role: "user", effectiveRoles: ["commander"] },
      ),
      true,
    );
  });

  await t.step(
    "priority: roles array first, then effectiveRoles, then role",
    () => {
      const check = hasRole("commander");
      assertEquals(
        check({ id: "1", role: "user", roles: ["commander"] }),
        true,
      );
      assertEquals(
        check({ id: "1", role: "user", effectiveRoles: ["commander"] }),
        true,
      );
      assertEquals(check({ id: "1", role: "commander" }), true);
      assertEquals(check({ id: "1", role: "user" }), false);
    },
  );

  await t.step("multiple roles: any match is sufficient", () => {
    const check = hasRole("admin", "commander");
    assertEquals(check({ id: "1", role: "admin" }), true);
    assertEquals(check({ id: "1", role: "commander" }), true);
    assertEquals(check({ id: "1", role: "user" }), false);
  });
});

Deno.test("auth", async (t) => {
  await t.step("createToken produces a signed JWT", async () => {
    const token = await createToken(adminUser, config);
    assertEquals(typeof token, "string");
    assertEquals(token.split(".").length, 3);
  });

  await t.step("getUser decodes a valid token from cookie", async () => {
    const token = await createToken(adminUser, config);
    const req = new Request("http://localhost/", {
      headers: { Cookie: `test_session=${token}` },
    });
    const c = new Context(req);
    const user = await getUser(c, config);
    assertEquals(user?.id, "admin");
    assertEquals(user?.role, "admin");
  });

  await t.step(
    "getUser decodes a valid token from query param when allowed",
    async () => {
      const token = await createToken(adminUser, config);
      const queryConfig = { ...config, allowQueryToken: true };
      const req = new Request(`http://localhost/?token=${token}`);
      const c = new Context(req);
      const user = await getUser(c, queryConfig);
      assertEquals(user?.id, "admin");
      assertEquals(user?.role, "admin");
    },
  );

  await t.step(
    "getUser ignores query param when allowQueryToken is false",
    async () => {
      const token = await createToken(adminUser, config);
      const req = new Request(`http://localhost/?token=${token}`);
      const c = new Context(req);
      const user = await getUser(c, config);
      assertEquals(user, null);
    },
  );

  await t.step("getUser returns null for missing token", async () => {
    const req = new Request("http://localhost/");
    const c = new Context(req);
    const user = await getUser(c, config);
    assertEquals(user, null);
  });

  await t.step("getUser returns null for invalid token", async () => {
    const req = new Request("http://localhost/", {
      headers: { Cookie: "test_session=bad.token.here" },
    });
    const c = new Context(req);
    const user = await getUser(c, config);
    assertEquals(user, null);
  });

  await t.step("getUser returns null for expired token", async () => {
    const expiredConfig = { ...config, sessionExpiry: -10 };
    const token = await createToken(adminUser, expiredConfig);
    const req = new Request("http://localhost/", {
      headers: { Cookie: `test_session=${token}` },
    });
    const c = new Context(req);
    const user = await getUser(c, config);
    assertEquals(user, null);
  });

  await t.step(
    "getUser returns null for JWT with malformed payload",
    async () => {
      const badUser = { id: 123, role: true, extra: "should be stripped" };
      // Sign with matching config so verify passes, but Valibot should reject shape
      const { sign } = await import("@hono/hono/jwt");
      const token = await sign(
        { ...badUser, exp: Math.floor(Date.now() / 1000) + 3600 },
        config.jwtSecret,
      );
      const req = new Request("http://localhost/", {
        headers: { Cookie: `test_session=${token}` },
      });
      const c = new Context(req);
      const user = await getUser(c, config);
      assertEquals(user, null);
    },
  );

  await t.step("setSessionCookie sets the cookie on context", () => {
    const req = new Request("http://localhost/");
    const c = new Context(req);
    setSessionCookie(c, "test-token-value", config);

    const resp = c.text("ok");
    const setCookie = resp.headers.get("set-cookie");
    assertExists(setCookie);
    assertEquals(setCookie.includes("test_session=test-token-value"), true);
    assertEquals(setCookie.includes("HttpOnly"), true);
    assertEquals(setCookie.includes("Path=/"), true);
    assertEquals(setCookie.includes("SameSite=Lax"), true);
    assertEquals(setCookie.includes("Secure"), false);
  });

  await t.step("clearSessionCookie deletes the cookie", () => {
    const req = new Request("http://localhost/");
    const c = new Context(req);
    clearSessionCookie(c, config);

    const resp = c.text("ok");
    const setCookie = resp.headers.get("set-cookie");
    assertExists(setCookie);
    assertEquals(setCookie.includes("test_session=;"), true);
    assertEquals(setCookie.includes("Max-Age=0"), true);
  });
});

Deno.test("auth middleware", async (t) => {
  await t.step(
    "createAuthMiddleware sets c.get('user') for valid token",
    async () => {
      const token = await createToken(adminUser, config);
      const app = new Hono();
      app.use("*", createAuthMiddleware(config));
      // deno-lint-ignore no-explicit-any
      app.get("/test", (c: any) => {
        const user = c.get("user");
        return c.json({ id: user?.id, role: user?.role });
      });

      const res = await app.request("http://localhost/test", {
        headers: { Cookie: `test_session=${token}` },
      });
      const body = await res.json();
      assertEquals(body.id, "admin");
      assertEquals(body.role, "admin");
    },
  );

  await t.step(
    "createAuthMiddleware does not set user for missing token",
    async () => {
      const app = new Hono();
      app.use("*", createAuthMiddleware(config));
      // deno-lint-ignore no-explicit-any
      app.get("/test", (c: any) => {
        const user = c.get("user");
        return c.json({ user: user ?? null });
      });

      const res = await app.request("http://localhost/test");
      const body = await res.json();
      assertEquals(body.user, null);
    },
  );

  await t.step("requireUser redirects to sign-in when no user", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware(config));
    // deno-lint-ignore no-explicit-any
    app.get("/protected", requireUser(), (c: any) => c.text("ok"));

    const res = await app.request("http://localhost/protected");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/signin");
  });

  await t.step("requireUser passes through when user is set", async () => {
    const token = await createToken(adminUser, config);
    const app = new Hono();
    app.use("*", createAuthMiddleware(config));
    app.get("/protected", requireUser(), (c) => c.text("ok"));

    const res = await app.request("http://localhost/protected", {
      headers: { Cookie: `test_session=${token}` },
    });
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
  });

  await t.step("requireRole returns 403 for wrong role", async () => {
    const token = await createToken(adminUser, config);
    const app = new Hono();
    app.use("*", createAuthMiddleware(config));
    app.get("/admin", requireRole("superadmin"), (c) => c.text("ok"));

    const res = await app.request("http://localhost/admin", {
      headers: { Cookie: `test_session=${token}` },
    });
    assertEquals(res.status, 403);
    const body = await res.json();
    assertEquals(body.error, "forbidden");
  });

  await t.step("requireRole passes through for correct role", async () => {
    const token = await createToken(adminUser, config);
    const app = new Hono();
    app.use("*", createAuthMiddleware(config));
    app.get("/admin", requireRole("admin"), (c) => c.text("ok"));

    const res = await app.request("http://localhost/admin", {
      headers: { Cookie: `test_session=${token}` },
    });
    assertEquals(res.status, 200);
    assertEquals(await res.text(), "ok");
  });

  await t.step("requireRole redirects when no user", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware(config));
    app.get("/admin", requireRole("admin"), (c) => c.text("ok"));

    const res = await app.request("http://localhost/admin");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/signin");
  });

  await t.step("requireUser returns 401 JSON for /api/ routes", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware(config));
    app.get("/api/data", requireUser(), (c) => c.text("ok"));

    const res = await app.request("http://localhost/api/data");
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, "unauthorized");
    assertEquals(body.message, "Authentication required");
  });

  await t.step("requireUser accepts custom redirectUrl", async () => {
    const app = new Hono();
    app.use("*", createAuthMiddleware(config));
    app.get(
      "/custom",
      requireUser({ redirectUrl: "/custom-login" }),
      (c) => c.text("ok"),
    );

    const res = await app.request("http://localhost/custom");
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/custom-login");
  });
});
