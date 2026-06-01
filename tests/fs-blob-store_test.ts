import { assertEquals } from "@std/assert";
import { FsBlobStore } from "../src/core/fs-blob-store.ts";

function makeTempStore(): { store: FsBlobStore; dir: string } {
  const dir = Deno.makeTempDirSync({ prefix: "blenny-fs-blob-" });
  const store = new FsBlobStore(dir);
  return { store, dir };
}

Deno.test("FsBlobStore", async (t) => {
  const { store, dir } = makeTempStore();

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
      assertEquals(res.headers.get("Content-Type"), "text/plain");
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

  await t.step("remove is safe for non-existent blob", async () => {
    await store.remove("nonexistent", "nothing");
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

  Deno.removeSync(dir, { recursive: true });
});
