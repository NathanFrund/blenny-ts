import type { Context } from "@hono/hono";
import type { Conduit } from "../../core/conduit.ts";
import type { AuthConfig } from "../../core/auth.ts";
import type { BlobStore, UserStore } from "../../core/store.ts";
import type { AvatarHandlerDeps } from "../../lib/avatar/handlers.ts";

export const state = {
  store: undefined! as unknown as UserStore,
  blobStore: undefined! as unknown as BlobStore,
  kv: undefined as Deno.Kv | undefined,
  conduit: undefined! as unknown as Conduit,
  config: undefined! as unknown as AuthConfig,
  deps: undefined as AvatarHandlerDeps | undefined,
  handleAvatarUpload: undefined as
    | ((c: Context) => Promise<Response>)
    | undefined,
  handleAvatarServe: undefined as
    | ((c: Context) => Promise<Response>)
    | undefined,
};
