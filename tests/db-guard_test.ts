import { test } from "bun:test";
import { DbError } from "@blenny/core/db-connection.ts";
import { requireDb, withDb } from "@blenny/core/db-guard.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";

test("requireDb", async () => {
  await step("throws DbError when db is undefined", () => {
    assertThrows(() => requireDb(undefined), DbError, "Database is not connected");
  });

  await step("returns db when defined", () => {
    const fakeDb = { query: () => [] } as any;
    const result = requireDb(fakeDb);
    assertEquals(result, fakeDb);
  });

  await step("includes context string in error message", () => {
    assertThrows(() => requireDb(undefined, "chat-history"), DbError, "Database is not connected (chat-history)");
  });
});

test("withDb", async () => {
  await step("returns fallback when db is undefined", async () => {
    const result = await withDb(undefined, (_db) => Promise.resolve("should not run"), "fallback");
    assertEquals(result, "fallback");
  });

  await step("calls fn and returns result when db is defined", async () => {
    const fakeDb = { query: () => ["result"] } as any;
    const result = await withDb(fakeDb, (_db) => Promise.resolve("worked"), "fallback");
    assertEquals(result, "worked");
  });

  await step("returns fallback when fn throws (non-DbError)", async () => {
    const fakeDb = {
      query: () => {
        throw new Error("db down");
      },
    } as any;
    const result = await withDb(fakeDb, (_db) => Promise.reject(new Error("boom")), "safe-fallback");
    assertEquals(result, "safe-fallback");
  });

  await step("re-throws DbError", async () => {
    const fakeDb = {} as any;
    await assertRejects(
      () => withDb(fakeDb, (_db) => Promise.reject(new DbError("permission denied")), "fallback"),
      DbError,
      "permission denied",
    );
  });
});
