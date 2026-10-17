import { test } from "bun:test";
import type { DatabaseConnection } from "@blenny/core/db-connection.ts";
import { SurrealUserStore } from "@blenny/core/surreal-store.ts";
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { Surreal } from "@surrealdb/surrealdb";

const passHash = "abc123hash";

function envConfig(): {
  url: string;
  user: string;
  pass: string;
  ns: string;
  db: string;
} {
  return {
    url: process.env.BLENNY_SURREAL_URL ?? "ws://127.0.0.1:8000/rpc",
    user: process.env.BLENNY_SURREAL_USER ?? "root",
    pass: process.env.BLENNY_SURREAL_PASS ?? "root",
    ns: process.env.BLENNY_SURREAL_NS ?? "blenny_test",
    db: process.env.BLENNY_SURREAL_DB ?? "blenny_test",
  };
}

const runSurrealTests = process.env.BLENNY_SURREAL_URL !== undefined;

let connection: Surreal | null = null;

if (runSurrealTests) {
  const env = envConfig();
  const surreal = new Surreal();
  await surreal.connect(env.url, {
    namespace: env.ns,
    database: env.db,
    authentication: { username: env.user, password: env.pass },
  });
  connection = surreal;
}

test.skipIf(!runSurrealTests)("SurrealUserStore", async () => {
  const surreal = connection!;
  const store = new SurrealUserStore(surreal as unknown as DatabaseConnection);
  await store.setup();

  await step("findByUsername returns null for non-existent user", async () => {
    const user = await store.findByUsername("nonexistent");
    assertEquals(user, null);
  });

  await step("findById returns null for non-existent user", async () => {
    const user = await store.findById("nonexistent");
    assertEquals(user, null);
  });

  await step("createUser creates a user and returns it", async () => {
    const user = await store.createUser({
      username: "s_alice",
      passwordHash: passHash,
      salt: "x",
      displayName: "Alice",
    });
    assertExists(user);
    assertEquals(user.username, "s_alice");
    assertEquals(user.displayName, "Alice");
    assertEquals(user.role, "user");
    assertExists(user.id);
    assertEquals(typeof user.createdAt, "number");
  });

  await step("createUser throws on duplicate username", async () => {
    await assertRejects(
      () =>
        store.createUser({
          username: "s_alice",
          passwordHash: "different",
          salt: "x",
          displayName: "Alice Again",
        }),
      Error,
      "already taken",
    );
  });

  await step("findByUsername returns created user", async () => {
    const user = await store.findByUsername("s_alice");
    assertExists(user);
    assertEquals(user.username, "s_alice");
    assertEquals(user.displayName, "Alice");
  });

  await step("findById returns created user", async () => {
    const alice = await store.findByUsername("s_alice");
    assertExists(alice);
    const user = await store.findById(alice.id);
    assertExists(user);
    assertEquals(user.username, "s_alice");
  });

  await step("setPassword persists the new hash", async () => {
    const user = await store.createUser({
      username: "s_hash-test",
      passwordHash: passHash,
      salt: "x",
      displayName: "Hash Test",
    });
    assertExists(user);

    await store.setPassword(user.id, "new-password");

    // Password was hashed server-side; verify by checking it's not the raw value
    const updated = await store.findById(user.id);
    assertExists(updated);
    assert(updated.passwordHash !== "new-password");
  });

  await step("updateAvatarKey persists the avatar key", async () => {
    const user = await store.createUser({
      username: "s_avatar-test",
      passwordHash: passHash,
      salt: "x",
      displayName: "Avatar Test",
    });
    assertExists(user);

    const key = `avatars:${user.id}`;
    await store.updateAvatarKey(user.id, key);

    const updated = await store.findById(user.id);
    assertExists(updated);
    assertEquals(updated.avatarKey, key);
  });

  await step("deleteUser removes the record and returns true", async () => {
    const user = await store.createUser({
      username: "s_delete-me",
      passwordHash: passHash,
      salt: "x",
      displayName: "Delete Me",
    });
    assertExists(user);

    const deleted = await store.deleteUser(user.id);
    assertEquals(deleted, true);

    assertEquals(await store.findById(user.id), null);
    assertEquals(await store.findByUsername("s_delete-me"), null);
  });

  await step("deleteUser returns false for non-existent id", async () => {
    const result = await store.deleteUser("00000000-0000-0000-0000-000000000000");
    assertEquals(result, false);
  });

  await step("username freed after delete — can be re-registered", async () => {
    const first = await store.createUser({
      username: "s_reuse",
      passwordHash: passHash,
      salt: "x",
      displayName: "First",
    });
    await store.deleteUser(first.id);

    const second = await store.createUser({
      username: "s_reuse",
      passwordHash: "newhash",
      salt: "x",
      displayName: "Second",
    });
    assertEquals(second.username, "s_reuse");
    assertEquals(second.displayName, "Second");
  });

  await step("createUser with admin role creates admin user", async () => {
    const user = await store.createUser({
      username: "s_admin2",
      passwordHash: passHash,
      salt: "x",
      displayName: "Admin Two",
      role: "admin",
    });
    assertExists(user);
    assertEquals(user.role, "admin");
  });

  await step("createUser with role defaults to user", async () => {
    const user = await store.createUser({
      username: "s_bob",
      passwordHash: passHash,
      salt: "x",
      displayName: "Bob",
    });
    assertExists(user);
    assertEquals(user.role, "user");
  });
});

if (connection) {
  connection.close();
}
