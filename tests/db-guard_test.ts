import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { DbError } from "@blenny/core/db-connection.ts";
import { requireDb, withDb } from "@blenny/core/db-guard.ts";

Deno.test("requireDb", async (t) => {
  await t.step("throws DbError when db is undefined", () => {
    assertThrows(
      () => requireDb(undefined),
      DbError,
      "Database is not connected",
    );
  });

  await t.step("returns db when defined", () => {
    // deno-lint-ignore no-explicit-any
    const fakeDb = { query: () => [] } as any;
    const result = requireDb(fakeDb);
    assertEquals(result, fakeDb);
  });

  await t.step("includes context string in error message", () => {
    assertThrows(
      () => requireDb(undefined, "chat-history"),
      DbError,
      "Database is not connected (chat-history)",
    );
  });
});

Deno.test("withDb", async (t) => {
  await t.step("returns fallback when db is undefined", async () => {
    const result = await withDb(
      undefined,
      (_db) => Promise.resolve("should not run"),
      "fallback",
    );
    assertEquals(result, "fallback");
  });

  await t.step("calls fn and returns result when db is defined", async () => {
    // deno-lint-ignore no-explicit-any
    const fakeDb = { query: () => ["result"] } as any;
    const result = await withDb(
      fakeDb,
      (_db) => Promise.resolve("worked"),
      "fallback",
    );
    assertEquals(result, "worked");
  });

  await t.step("returns fallback when fn throws (non-DbError)", async () => {
    const fakeDb = {
      query: () => {
        throw new Error("db down");
      },
      // deno-lint-ignore no-explicit-any
    } as any;
    const result = await withDb(
      fakeDb,
      (_db) => Promise.reject(new Error("boom")),
      "safe-fallback",
    );
    assertEquals(result, "safe-fallback");
  });

  await t.step("re-throws DbError", async () => {
    // deno-lint-ignore no-explicit-any
    const fakeDb = {} as any;
    await assertRejects(
      () =>
        withDb(
          fakeDb,
          (_db) => Promise.reject(new DbError("permission denied")),
          "fallback",
        ),
      DbError,
      "permission denied",
    );
  });
});
