import type { Surreal } from "@surrealdb/surrealdb";
import type { Conduit } from "../../core/conduit.ts";
import type { AuthConfig } from "../../core/auth.ts";
import type { BlobStore, UserStore } from "../../core/store.ts";

export const state = {
  store: undefined! as unknown as UserStore,
  blobStore: undefined as BlobStore | undefined,
  db: undefined as Surreal | undefined,
  conduit: undefined! as unknown as Conduit,
  config: undefined! as unknown as AuthConfig,
};
