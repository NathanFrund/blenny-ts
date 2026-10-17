import { test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsBlobStore } from "@blenny/core/fs-blob-store.ts";
import { assertEquals } from "@std/assert";

function makeTempStore(): { store: FsBlobStore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "blenny-fs-blob-"));
  const store = new FsBlobStore(dir);
  return { store, dir };
}

test("FsBlobStore", async () => {
  const { store, dir } = makeTempStore();

  await step("set stores a file blob and returns prefix:id key", async () => {
    const file = new File(["hello world"], "test.txt", { type: "text/plain" });
    const result = await store.set("avatars", "user-1", file);
    assertEquals(result, "avatars:user-1");
  });

  await step("getAsResponse retrieves the blob with content type", async () => {
    const file = new File(["hello world"], "test.txt", {
      type: "text/plain",
    });
    await store.set("avatars", "user-1", file);

    const res = await store.getAsResponse("avatars", "user-1");
    assertEquals(res.status, 200);
    // Bun's File appends ";charset=utf-8" to text/* types, so round-trip
    // against the declared type rather than the Deno-normalized literal.
    assertEquals(res.headers.get("Content-Type"), file.type);
    assertEquals(await res.text(), "hello world");
  });

  await step("getAsResponse returns 404 for missing blob", async () => {
    const res = await store.getAsResponse("avatars", "nonexistent");
    assertEquals(res.status, 404);
  });

  await step("remove deletes a blob", async () => {
    const file = new File(["data"], "test.txt", { type: "text/plain" });
    await store.set("maps", "map-1", file);
    await store.remove("maps", "map-1");

    const res = await store.getAsResponse("maps", "map-1");
    assertEquals(res.status, 404);
  });

  await step("remove is safe for non-existent blob", async () => {
    await store.remove("nonexistent", "nothing");
  });

  await step("different prefixes are isolated", async () => {
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

  rmSync(dir, { recursive: true, force: true });
});
