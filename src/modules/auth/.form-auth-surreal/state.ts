import type { AuthConfig } from "@blenny/core/auth.ts";
import type { Conduit } from "@blenny/core/conduit.ts";
import type { DatabaseConnection } from "@blenny/core/db-connection.ts";
import type { UserStore } from "@blenny/core/store.ts";
import type { AvatarHandlerDeps } from "@blenny/lib/avatar/handlers.ts";
import type { Context } from "@hono/hono";

export const state = {
  store: undefined! as unknown as UserStore,
  db: undefined as DatabaseConnection | undefined,
  conduit: undefined! as unknown as Conduit,
  config: undefined! as unknown as AuthConfig,
  deps: undefined as AvatarHandlerDeps | undefined,
  handleAvatarUpload: undefined as ((c: Context) => Promise<Response>) | undefined,
  handleAvatarServe: undefined as ((c: Context) => Promise<Response>) | undefined,
};
