import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { createInMemoryUserStore } from "../src/core/user-store.ts";

const passHash = "abc123hash";

Deno.test("user-store", async (t) => {
  const store = createInMemoryUserStore();

  await t.step(
    "findByUsername returns null for non-existent user",
    async () => {
      const user = await store.findByUsername("nonexistent");
      assertEquals(user, null);
    },
  );

  await t.step("findById returns null for non-existent user", async () => {
    const user = await store.findById("nonexistent");
    assertEquals(user, null);
  });

  await t.step("createUser creates a user and returns it", async () => {
    const user = await store.createUser({
      username: "alice",
      passwordHash: passHash,
      salt: "x",
      displayName: "Alice",
    });
    assertExists(user);
    assertEquals(user.username, "alice");
    assertEquals(user.displayName, "Alice");
    assertEquals(user.role, "user");
    assertExists(user.id);
    assertEquals(typeof user.createdAt, "number");
  });

  await t.step("createUser throws on duplicate username", async () => {
    await assertRejects(
      () =>
        store.createUser({
          username: "alice",
          passwordHash: "different",
          salt: "x",
          displayName: "Alice Again",
        }),
      Error,
      "already taken",
    );
  });

  await t.step("findByUsername returns created user", async () => {
    const user = await store.findByUsername("alice");
    assertExists(user);
    assertEquals(user.username, "alice");
    assertEquals(user.displayName, "Alice");
  });

  await t.step("findById returns created user", async () => {
    const alice = await store.findByUsername("alice");
    assertExists(alice);
    const user = await store.findById(alice.id);
    assertExists(user);
    assertEquals(user.username, "alice");
  });

  await t.step("updatePasswordHash persists the new hash", async () => {
    const user = await store.createUser({
      username: "hash-test",
      passwordHash: passHash,
      salt: "x",
      displayName: "Hash Test",
    });
    assertExists(user);

    await store.updatePasswordHash(user.id, "newhash999");

    const updated = await store.findById(user.id);
    assertExists(updated);
    assertEquals(updated.passwordHash, "newhash999");
  });

  await t.step("updateAvatarKey persists the avatar key", async () => {
    const user = await store.createUser({
      username: "avatar-test",
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

  await t.step("deleteUser removes the record and returns true", async () => {
    const user = await store.createUser({
      username: "delete-me",
      passwordHash: passHash,
      salt: "x",
      displayName: "Delete Me",
    });
    assertExists(user);

    const deleted = await store.deleteUser(user.id);
    assertEquals(deleted, true);

    assertEquals(await store.findById(user.id), null);
    assertEquals(await store.findByUsername("delete-me"), null);
  });

  await t.step("deleteUser returns false for non-existent id", async () => {
    const result = await store.deleteUser(
      "00000000-0000-0000-0000-000000000000",
    );
    assertEquals(result, false);
  });

  await t.step(
    "username freed after delete — can be re-registered",
    async () => {
      const first = await store.createUser({
        username: "reuse",
        passwordHash: passHash,
        salt: "x",
        displayName: "First",
      });
      await store.deleteUser(first.id);

      const second = await store.createUser({
        username: "reuse",
        passwordHash: "newhash",
        salt: "x",
        displayName: "Second",
      });
      assertEquals(second.username, "reuse");
      assertEquals(second.displayName, "Second");
    },
  );

  await t.step("createUser with admin role creates admin user", async () => {
    const user = await store.createUser({
      username: "admin2",
      passwordHash: passHash,
      salt: "x",
      displayName: "Admin Two",
      role: "admin",
    });
    assertExists(user);
    assertEquals(user.role, "admin");
  });

  await t.step("createUser with role defaults to user", async () => {
    const user = await store.createUser({
      username: "bob",
      passwordHash: passHash,
      salt: "x",
      displayName: "Bob",
    });
    assertExists(user);
    assertEquals(user.role, "user");
  });
});
