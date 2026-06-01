import { assertEquals } from "@std/assert";
import { BlennyError, errorResponse } from "../src/core/error.ts";

Deno.test("BlennyError notFound factory", () => {
  const err = BlennyError.notFound();
  assertEquals(err.type, "not_found");
  assertEquals(err.message, "Not Found");
  assertEquals(err.statusCode, 404);
  assertEquals(err.toJSON(), {
    error: { type: "not_found", message: "Not Found" },
  });
});

Deno.test("BlennyError unauthorized factory", () => {
  const err = BlennyError.unauthorized();
  assertEquals(err.type, "unauthorized");
  assertEquals(err.message, "Unauthorized");
  assertEquals(err.statusCode, 401);
});

Deno.test("BlennyError internal factory", () => {
  const err = BlennyError.internal("Custom message");
  assertEquals(err.type, "internal");
  assertEquals(err.message, "Custom message");
  assertEquals(err.statusCode, 500);
});

Deno.test("BlennyError instance of Error", () => {
  const err = BlennyError.notFound();
  assertEquals(err instanceof Error, true);
  assertEquals(err.name, "BlennyError");
});

Deno.test("BlennyError thrown in app returns structured JSON", async () => {
  const { Hono } = await import("@hono/hono");
  const app = new Hono();

  app.onError((err, _c) => {
    if (err instanceof BlennyError) {
      return errorResponse(err.toJSON(), err.statusCode);
    }
    console.error(err);
    return errorResponse({
      error: { type: "internal", message: "Internal Server Error" },
    }, 500);
  });

  app.get("/throws-blenny", () => {
    throw BlennyError.notFound("User not found");
  });

  app.get("/throws-generic", () => {
    throw new Error("something broke");
  });

  app.notFound((_c) => {
    return errorResponse(
      { error: { type: "not_found", message: "Not Found" } },
      404,
    );
  });

  const res1 = await app.request("http://localhost/throws-blenny");
  assertEquals(res1.status, 404);
  const body1 = await res1.json() as Record<string, unknown>;
  assertEquals(body1, {
    error: { type: "not_found", message: "User not found" },
  });

  const res2 = await app.request("http://localhost/throws-generic");
  assertEquals(res2.status, 500);
  const body2 = await res2.json() as Record<string, unknown>;
  assertEquals(body2, {
    error: { type: "internal", message: "Internal Server Error" },
  });

  const res3 = await app.request("http://localhost/unknown-path");
  assertEquals(res3.status, 404);
  const body3 = await res3.json() as Record<string, unknown>;
  assertEquals(body3, { error: { type: "not_found", message: "Not Found" } });
});
