import { test } from "bun:test";
import { createErrorHandler } from "@blenny/core/bootstrap/middlewares.ts";
import { BlennyError, errorResponse } from "@blenny/core/error.ts";
import { csrf } from "@hono/hono/csrf";
import { assertEquals } from "@std/assert";

test("BlennyError notFound factory", () => {
  const err = BlennyError.notFound();
  assertEquals(err.type, "not_found");
  assertEquals(err.message, "Not Found");
  assertEquals(err.statusCode, 404);
  assertEquals(err.toJSON(), {
    error: { type: "not_found", message: "Not Found" },
  });
});

test("BlennyError unauthorized factory", () => {
  const err = BlennyError.unauthorized();
  assertEquals(err.type, "unauthorized");
  assertEquals(err.message, "Unauthorized");
  assertEquals(err.statusCode, 401);
});

test("BlennyError internal factory", () => {
  const err = BlennyError.internal("Custom message");
  assertEquals(err.type, "internal");
  assertEquals(err.message, "Custom message");
  assertEquals(err.statusCode, 500);
});

test("BlennyError instance of Error", () => {
  const err = BlennyError.notFound();
  assertEquals(err instanceof Error, true);
  assertEquals(err.name, "BlennyError");
});

test("BlennyError thrown in app returns structured JSON", async () => {
  const { Hono } = await import("@hono/hono");
  const app = new Hono();

  app.onError((err, _c) => {
    if (err instanceof BlennyError) {
      return errorResponse(err.toJSON(), err.statusCode);
    }
    console.error(err);
    return errorResponse(
      {
        error: { type: "internal", message: "Internal Server Error" },
      },
      500,
    );
  });

  app.get("/throws-blenny", () => {
    throw BlennyError.notFound("User not found");
  });

  app.get("/throws-generic", () => {
    throw new Error("something broke");
  });

  app.notFound((_c) => {
    return errorResponse({ error: { type: "not_found", message: "Not Found" } }, 404);
  });

  const res1 = await app.request("http://localhost/throws-blenny");
  assertEquals(res1.status, 404);
  const body1 = (await res1.json()) as Record<string, unknown>;
  assertEquals(body1, {
    error: { type: "not_found", message: "User not found" },
  });

  const res2 = await app.request("http://localhost/throws-generic");
  assertEquals(res2.status, 500);
  const body2 = (await res2.json()) as Record<string, unknown>;
  assertEquals(body2, {
    error: { type: "internal", message: "Internal Server Error" },
  });

  const res3 = await app.request("http://localhost/unknown-path");
  assertEquals(res3.status, 404);
  const body3 = (await res3.json()) as Record<string, unknown>;
  assertEquals(body3, { error: { type: "not_found", message: "Not Found" } });
});

test("csrf() rejection is handled as 403 JSON (not 500)", async () => {
  const { Hono } = await import("@hono/hono");
  const app = new Hono();
  app.use("*", csrf());
  createErrorHandler(app);
  app.post("/submit", (c) => c.text("ok"));

  const blocked = await app.request("http://localhost/submit", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "a=b",
  });
  assertEquals(blocked.status, 403);
  assertEquals(await blocked.json(), {
    error: { type: "forbidden", message: "Forbidden" },
  });

  const allowed = await app.request("http://localhost/submit", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "http://localhost",
    },
    body: "a=b",
  });
  assertEquals(allowed.status, 200);
  assertEquals(await allowed.text(), "ok");
});

test("createErrorHandler keeps BlennyError and generic-error behaviour", async () => {
  const { Hono } = await import("@hono/hono");
  const app = new Hono();
  createErrorHandler(app);
  app.get("/blenny", () => {
    throw BlennyError.notFound("User not found");
  });
  app.get("/boom", () => {
    throw new Error("kaboom");
  });

  const r1 = await app.request("http://localhost/blenny");
  assertEquals(r1.status, 404);
  assertEquals(await r1.json(), {
    error: { type: "not_found", message: "User not found" },
  });

  const r2 = await app.request("http://localhost/boom");
  assertEquals(r2.status, 500);
  assertEquals(await r2.json(), {
    error: { type: "internal", message: "Internal Server Error" },
  });
});
