import type { Conduit } from "../../core/conduit.ts";
import type { AuthConfig } from "../../core/auth.ts";
import type { BlobStore, UserStore } from "../../core/store.ts";

export const state = {
  store: undefined! as unknown as UserStore,
  blobStore: undefined! as unknown as BlobStore,
  kv: undefined as Deno.Kv | undefined,
  conduit: undefined! as unknown as Conduit,
  config: undefined! as unknown as AuthConfig,
};
