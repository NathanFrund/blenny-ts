import type { Context } from "@hono/hono";
import type { UserInfo } from "../../core/auth.ts";
import type { UserStore } from "../../core/store.ts";
import type { AvatarService } from "./service.ts";

export interface AvatarHandlerDeps {
  store: UserStore;
  avatarService: AvatarService;
}

export function createHandleAvatarUpload(
  deps: AvatarHandlerDeps,
): (c: Context) => Promise<Response> {
  const { store, avatarService } = deps;
  return async (c: Context): Promise<Response> => {
    const user = c.get("user") as UserInfo | undefined;
    if (!user) return c.redirect("/auth/signin");

    const form = await c.req.parseBody();
    const file = form.avatar;

    if (!(file instanceof File)) {
      return c.redirect(
        `/auth/profile?error=${encodeURIComponent("avatar field must be a file")}`,
      );
    }

    if (!file.type.startsWith("image/")) {
      return c.redirect(
        `/auth/profile?error=${encodeURIComponent("Only image files are accepted")}`,
      );
    }

    const result = await avatarService.put(user.id, file);
    await store.updateAvatarKey(user.id, result.key);

    return c.redirect("/auth/profile");
  };
}

export function createHandleAvatarServe(
  deps: AvatarHandlerDeps,
): (c: Context) => Promise<Response> {
  const { avatarService } = deps;
  return async (c: Context): Promise<Response> => {
    const userId = c.req.param("userId");
    if (!userId) return c.json({ error: "Missing userId" }, 400);

    const result = await avatarService.get(userId);
    if (!result) return c.json({ error: "No avatar found" }, 404);

    return new Response(result.bytes as BodyInit, {
      headers: { "Content-Type": result.mimeType },
    });
  };
}
