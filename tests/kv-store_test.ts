import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  KvBlobStore,
  KvUserStore,
  openKvStore,
} from "@blenny/core/kv-store.ts";

const passHash = "abc123hash";

Deno.test("KvUserStore", async (t) => {
  const kv = await Deno.openKv(":memory:");
  const store = new KvUserStore(kv);

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

  await t.step(
    "deleteUser removes avatar blob when present",
    async () => {
      const user = await store.createUser({
        username: "avatar-delete",
        passwordHash: passHash,
        salt: "x",
        displayName: "Avatar Delete",
      });
      assertExists(user);

      await store.updateAvatarKey(user.id, `avatars:${user.id}`);
      const blobStore = new KvBlobStore(kv);
      const file = new File(["avatar data"], "avatar.png", {
        type: "image/png",
      });
      await blobStore.set("avatars", user.id, file);

      await store.deleteUser(user.id);

      const res = await blobStore.getAsResponse("avatars", user.id);
      assertEquals(res.status, 404);
    },
  );

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

  kv.close();
});

Deno.test("KvBlobStore", async (t) => {
  const kv = await Deno.openKv(":memory:");
  const store = new KvBlobStore(kv);

  await t.step("set stores a file blob and returns prefix:id key", async () => {
    const file = new File(["hello world"], "test.txt", { type: "text/plain" });
    const result = await store.set("avatars", "user-1", file);
    assertEquals(result, "avatars:user-1");
  });

  await t.step(
    "getAsResponse retrieves the blob with content type",
    async () => {
      const file = new File(["hello world"], "test.txt", {
        type: "text/plain",
      });
      await store.set("avatars", "user-1", file);

      const res = await store.getAsResponse("avatars", "user-1");
      assertEquals(res.status, 200);
      assertEquals(await res.text(), "hello world");
    },
  );

  await t.step("getAsResponse returns 404 for missing blob", async () => {
    const res = await store.getAsResponse("avatars", "nonexistent");
    assertEquals(res.status, 404);
  });

  await t.step("remove deletes a blob", async () => {
    const file = new File(["data"], "test.txt", { type: "text/plain" });
    await store.set("maps", "map-1", file);
    await store.remove("maps", "map-1");

    const res = await store.getAsResponse("maps", "map-1");
    assertEquals(res.status, 404);
  });

  await t.step("different prefixes are isolated", async () => {
    const f1 = new File(["avatar data"], "avatar.txt", {
      type: "text/plain",
    });
    const f2 = new File(["map data"], "map.txt", { type: "application/json" });

    await store.set("avatars", "item-1", f1);
    await store.set("maps", "item-1", f2);

    const res1 = await store.getAsResponse("avatars", "item-1");
    assertEquals(await res1.text(), "avatar data");

    const res2 = await store.getAsResponse("maps", "item-1");
    assertEquals(await res2.text(), "map data");
  });

  kv.close();
});

Deno.test("openKvStore factory", async (t) => {
  await t.step(
    "returns KvStores with working store and blobStore",
    async () => {
      const stores = await openKvStore(":memory:");
      try {
        assertExists(stores.kv);
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
        stores.kv.close();
      }
    },
  );
});
