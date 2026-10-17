import { test } from "bun:test";
import { deriveKey, verifyKey } from "@blenny/core/crypto.ts";
import { assertEquals } from "@std/assert";

test("crypto", async () => {
  await step("deriveKey returns a hash and salt", async () => {
    const result = await deriveKey("hunter2");
    assertEquals(typeof result.hash, "string");
    assertEquals(result.hash.length > 0, true);
    assertEquals(typeof result.salt, "string");
    assertEquals(result.salt.length > 0, true);
  });

  await step("deriveKey produces hex strings", async () => {
    const result = await deriveKey("hunter2");
    assertEquals(/^[0-9a-f]+$/.test(result.hash), true);
    assertEquals(/^[0-9a-f]+$/.test(result.salt), true);
  });

  await step("deriveKey generates a unique salt each call", async () => {
    const a = await deriveKey("hunter2");
    const b = await deriveKey("hunter2");
    assertEquals(a.salt !== b.salt, true);
  });

  await step("different salts produce different hashes", async () => {
    const a = await deriveKey("hunter2");
    const b = await deriveKey("hunter2");
    assertEquals(a.hash !== b.hash, true);
  });

  await step("verifyKey returns the same hash for correct password and salt", async () => {
    const { hash, salt } = await deriveKey("hunter2");
    const verified = await verifyKey("hunter2", salt);
    assertEquals(verified, hash);
  });

  await step("verifyKey returns different hash for wrong password", async () => {
    const { hash, salt } = await deriveKey("hunter2");
    const wrong = await verifyKey("wrong-password", salt);
    assertEquals(wrong !== hash, true);
  });

  await step("verifyKey is deterministic for same password and salt", async () => {
    const { salt } = await deriveKey("hunter2");
    const a = await verifyKey("hunter2", salt);
    const b = await verifyKey("hunter2", salt);
    assertEquals(a, b);
  });
});
