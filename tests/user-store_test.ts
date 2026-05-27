import { assertEquals, assertExists } from "@std/assert";
import { createUserStore } from "../src/core/user-store.ts";

Deno.test("user-store", async (t) => {
  const store = createUserStore();

  await t.step("findByUsername returns null for non-existent user", async () => {
    const user = await store.findByUsername("nonexistent");
    assertEquals(user, null);
  });

  await t.step("findById returns null for non-existent user", async () => {
    const user = await store.findById("nonexistent");
    assertEquals(user, null);
  });

  await t.step("createUser creates a user and returns it", async () => {
    const user = await store.createUser("alice", "password123", "Alice");
    assertExists(user);
    assertEquals(user.username, "alice");
    assertEquals(user.displayName, "Alice");
    assertEquals(user.role, "user");
    assertExists(user.id);
  });

  await t.step("createUser returns null for duplicate username", async () => {
    const user = await store.createUser("alice", "otherpass", "Alice Again");
    assertEquals(user, null);
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

  await t.step("verifyPassword returns user for correct password", async () => {
    const user = await store.verifyPassword("alice", "password123");
    assertExists(user);
    assertEquals(user.username, "alice");
  });

  await t.step("verifyPassword returns null for incorrect password", async () => {
    const user = await store.verifyPassword("alice", "wrongpassword");
    assertEquals(user, null);
  });

  await t.step("verifyPassword returns null for non-existent user", async () => {
    const user = await store.verifyPassword("nobody", "password");
    assertEquals(user, null);
  });

  await t.step("createUser with admin role creates admin user", async () => {
    const user = await store.createUser("admin2", "adminpass", "Admin Two", "admin");
    assertExists(user);
    assertEquals(user.role, "admin");
  });

  await t.step("createUser with role defaults to user", async () => {
    const user = await store.createUser("bob", "bobpassword", "Bob");
    assertExists(user);
    assertEquals(user.role, "user");
  });
});
