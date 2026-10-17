import { test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyKey } from "@blenny/core/crypto.ts";
import { FsBlobStore } from "@blenny/core/fs-blob-store.ts";
import { openSqliteStore } from "@blenny/core/sqlite-store.ts";
import { assertEquals, assertExists, assertRejects } from "@std/assert";

const passHash = "abc123hash";

function makeBlobStore(): { blobStore: FsBlobStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "blenny-sqlite-"));
  return { blobStore: new FsBlobStore(dir), dir };
}

test("SqliteUserStore", async () => {
  const { blobStore, dir } = makeBlobStore();
  const stores = openSqliteStore(":memory:", blobStore);
  const store = stores.store;

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

  await step("createUser throws on duplicate username", async () => {
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

  await step("findByUsername returns created user", async () => {
    const user = await store.findByUsername("alice");
    assertExists(user);
    assertEquals(user.username, "alice");
    assertEquals(user.displayName, "Alice");
  });

  await step("findById returns created user", async () => {
    const alice = await store.findByUsername("alice");
    assertExists(alice);
    const user = await store.findById(alice.id);
    assertExists(user);
    assertEquals(user.username, "alice");
  });

  await step("setPassword hashes and persists the new password", async () => {
    const user = await store.createUser({
      username: "hash-test",
      passwordHash: passHash,
      salt: "x",
      displayName: "Hash Test",
    });
    assertExists(user);

    await store.setPassword(user.id, "new-password");

    const updated = await store.findById(user.id);
    assertExists(updated);
    const expectedHash = await verifyKey("new-password", updated.salt);
    assertEquals(updated.passwordHash, expectedHash);
  });

  await step("updateAvatarKey persists the avatar key", async () => {
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

  await step("deleteUser removes the record and returns true", async () => {
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

  await step("deleteUser removes avatar blob when present", async () => {
    const user = await store.createUser({
      username: "avatar-delete",
      passwordHash: passHash,
      salt: "x",
      displayName: "Avatar Delete",
    });
    assertExists(user);

    await store.updateAvatarKey(user.id, `avatars:${user.id}`);
    const file = new File(["avatar data"], "avatar.png", {
      type: "image/png",
    });
    await blobStore.set("avatars", user.id, file);

    await store.deleteUser(user.id);

    const res = await blobStore.getAsResponse("avatars", user.id);
    assertEquals(res.status, 404);
  });

  await step("deleteUser returns false for non-existent id", async () => {
    const result = await store.deleteUser("00000000-0000-0000-0000-000000000000");
    assertEquals(result, false);
  });

  await step("username freed after delete — can be re-registered", async () => {
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
  });

  await step("createUser with admin role creates admin user", async () => {
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

  await step("createUser with role defaults to user", async () => {
    const user = await store.createUser({
      username: "bob",
      passwordHash: passHash,
      salt: "x",
      displayName: "Bob",
    });
    assertExists(user);
    assertEquals(user.role, "user");
  });

  stores.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test("openSqliteStore factory", async () => {
  await step("returns stores with working store and blobStore", async () => {
    const { blobStore, dir } = makeBlobStore();
    const stores = openSqliteStore(":memory:", blobStore);
    try {
      assertExists(stores.db);
      assertExists(stores.store);
      assertExists(stores.blobStore);

      const user = await stores.store.createUser({
        username: "factory-test",
        passwordHash: passHash,
        salt: "x",
        displayName: "Factory Test",
      });
      assertExists(user);
      assertEquals(user.username, "factory-test");

      const file = new File(["blob"], "test.txt", { type: "text/plain" });
      const key = await stores.blobStore.set("test", "item-1", file);
      assertEquals(key, "test:item-1");
    } finally {
      stores.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
