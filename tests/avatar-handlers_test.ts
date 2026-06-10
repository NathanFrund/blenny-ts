import { assertEquals } from "@std/assert";
import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import {
  createHandleAvatarServe,
  createHandleAvatarUpload,
} from "@blenny/lib/avatar/handlers.ts";
import type { AvatarService } from "@blenny/lib/avatar/service.ts";
import type { BlobStore, UserStore } from "@blenny/core/store.ts";

interface MockHandlers {
  upload: MiddlewareHandler;
  serve: MiddlewareHandler;
  setRemovedKey: (key: string) => void;
  setGetResult: (
    result: { bytes: Uint8Array; mimeType: string } | null,
  ) => void;
  getPutCall: () => { userId: string; file: File } | null;
  getUpdatedKey: () => string | null;
  getRemoved: () => { prefix: string; id: string } | null;
  store: UserStore;
  adminId: string;
}

function createMockHandlers(): MockHandlers {
  let removedKey: string | null = null;
  let getResult: { bytes: Uint8Array; mimeType: string } | null = null;
  let putCall: { userId: string; file: File } | null = null;
  let updatedKey: string | null = null;
  let removed: { prefix: string; id: string } | null = null;

  const adminId = crypto.randomUUID();

  const store: UserStore = {
    findById: (id: string) =>
      Promise.resolve(
        id === adminId
          ? {
            id: adminId,
            username: "admin",
            displayName: "Admin",
            role: "admin",
            passwordHash: "",
            salt: "",
            createdAt: Date.now(),
            avatarKey: removedKey ?? undefined,
          }
          : null,
      ),
    findByUsername: () => Promise.resolve(null),
    findAll: () => Promise.resolve([]),
    createUser: () => Promise.reject(new Error("not implemented")),
    setPassword: () => Promise.resolve(),
    updateAvatarKey: (_id: string, key: string) => {
      updatedKey = key;
      return Promise.resolve();
    },
    updateRole: () => Promise.resolve(),
    changePassword: () => Promise.resolve(),
    deleteUser: () => Promise.resolve(true),
  };

  const avatarService: AvatarService = {
    put: (userId: string, file: File) => {
      putCall = { userId, file };
      return Promise.resolve({ key: `avatars:${userId}:${Date.now()}` });
    },
    get: () => Promise.resolve(getResult),
  };

  const blobStore: BlobStore = {
    set: () => Promise.reject(new Error("not implemented")),
    getAsResponse: () => Promise.reject(new Error("not implemented")),
    remove: (prefix: string, id: string) => {
      removed = { prefix, id };
      return Promise.resolve();
    },
  };

  return {
    upload: createHandleAvatarUpload({ store, avatarService, blobStore }),
    serve: createHandleAvatarServe({ store, avatarService }),
    setRemovedKey: (key: string) => {
      removedKey = key;
    },
    setGetResult: (r) => {
      getResult = r;
    },
    getPutCall: () => putCall,
    getUpdatedKey: () => updatedKey,
    getRemoved: () => removed,
    store,
    adminId,
  };
}

Deno.test("avatar-handlers", async (t) => {
  await t.step("POST upload without auth redirects to sign-in", async () => {
    const m = createMockHandlers();
    const app = new Hono();
    app.post("/auth/avatar", m.upload);

    const form = new FormData();
    form.append(
      "avatar",
      new File([new Uint8Array([1, 2, 3])], "test.png", {
        type: "image/png",
      }),
    );
    const res = await app.request("http://localhost/auth/avatar", {
      method: "POST",
      body: form,
    });
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/signin");
  });

  await t.step("POST upload valid image succeeds", async () => {
    const m = createMockHandlers();
    const app = new Hono();
    app.use(
      "/auth/*",
      ((c, next) => {
        c.set("user", { id: m.adminId, role: "admin" });
        return next();
      }) as MiddlewareHandler,
    );
    app.post("/auth/avatar", m.upload);

    const form = new FormData();
    form.append(
      "avatar",
      new File([new Uint8Array([1, 2, 3])], "test.png", {
        type: "image/png",
      }),
    );
    const res = await app.request("http://localhost/auth/avatar", {
      method: "POST",
      body: form,
    });
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "/auth/profile");
    const call = m.getPutCall();
    assertEquals(call?.userId, m.adminId);
    assertEquals(call?.file.name, "test.png");
    assertEquals(
      m.getUpdatedKey()?.startsWith("avatars:" + m.adminId + ":"),
      true,
    );
  });

  await t.step("POST upload missing file field shows error", async () => {
    const m = createMockHandlers();
    const app = new Hono();
    app.use(
      "/auth/*",
      ((c, next) => {
        c.set("user", { id: m.adminId, role: "admin" });
        return next();
      }) as MiddlewareHandler,
    );
    app.post("/auth/avatar", m.upload);

    const form = new FormData();
    form.append("avatar", "not-a-file");
    const res = await app.request("http://localhost/auth/avatar", {
      method: "POST",
      body: form,
    });
    assertEquals(res.status, 302);
    assertEquals(
      res.headers.get("location"),
      "/auth/profile?error=avatar%20field%20must%20be%20a%20file",
    );
  });

  await t.step("POST upload non-image file type shows error", async () => {
    const m = createMockHandlers();
    const app = new Hono();
    app.use(
      "/auth/*",
      ((c, next) => {
        c.set("user", { id: m.adminId, role: "admin" });
        return next();
      }) as MiddlewareHandler,
    );
    app.post("/auth/avatar", m.upload);

    const form = new FormData();
    form.append(
      "avatar",
      new File([new Uint8Array([1, 2, 3])], "test.txt", {
        type: "text/plain",
      }),
    );
    const res = await app.request("http://localhost/auth/avatar", {
      method: "POST",
      body: form,
    });
    assertEquals(res.status, 302);
    assertEquals(
      res.headers.get("location"),
      "/auth/profile?error=Only%20image%20files%20are%20accepted",
    );
  });

  await t.step("POST upload replaces old avatar", async () => {
    const m = createMockHandlers();
    m.setRemovedKey("avatars:old.png");
    const app = new Hono();
    app.use(
      "/auth/*",
      ((c, next) => {
        c.set("user", { id: m.adminId, role: "admin" });
        return next();
      }) as MiddlewareHandler,
    );
    app.post("/auth/avatar", m.upload);

    const form = new FormData();
    form.append(
      "avatar",
      new File([new Uint8Array([1, 2, 3])], "new.png", {
        type: "image/png",
      }),
    );
    const res = await app.request("http://localhost/auth/avatar", {
      method: "POST",
      body: form,
    });
    assertEquals(res.status, 302);
    assertEquals(m.getRemoved()?.prefix, "avatars");
    assertEquals(m.getRemoved()?.id, "old.png");
  });

  await t.step("GET serve existing avatar returns image", async () => {
    const m = createMockHandlers();
    m.setGetResult({ bytes: new Uint8Array([4, 5, 6]), mimeType: "image/png" });
    const app = new Hono();
    app.get("/avatars/:userId", m.serve);

    const res = await app.request(`http://localhost/avatars/${m.adminId}`);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    assertEquals(bytes, new Uint8Array([4, 5, 6]));
  });

  await t.step("GET serve user without avatar returns 404", async () => {
    const m = createMockHandlers();
    m.setGetResult(null);
    const app = new Hono();
    app.get("/avatars/:userId", m.serve);

    const res = await app.request(`http://localhost/avatars/${m.adminId}`);
    assertEquals(res.status, 404);
    assertEquals(await res.json(), { error: "No avatar found" });
  });
});
