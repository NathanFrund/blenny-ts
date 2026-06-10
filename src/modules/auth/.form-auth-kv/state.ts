import type { Context } from "@hono/hono";
import type { Conduit } from "@blenny/core/conduit.ts";
import type { AuthConfig } from "@blenny/core/auth.ts";
import type { ComponentCatalog } from "@blenny/core/component-catalog.ts";
import type { BlobStore, UserStore } from "@blenny/core/store.ts";
import type { AvatarHandlerDeps } from "@blenny/lib/avatar/handlers.ts";

export const state = {
  store: undefined! as unknown as UserStore,
  components: undefined! as unknown as ComponentCatalog,
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
