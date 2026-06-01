import type { AppState } from "../../core/app-state.ts";
import {
  createAuthMiddleware,
  requireRole,
  requireUser,
} from "../../core/auth.ts";
import { openKvStore } from "../../core/kv-store.ts";
import { createInMemoryUserStore } from "../../core/user-store.ts";
import { FsBlobStore } from "../../core/fs-blob-store.ts";
import type { BlennyModule } from "../../types.ts";
import { deriveKey } from "./crypto.ts";
import { state } from "./state.ts";
import {
  handleAvatarServe,
  handleAvatarUpload,
  handleRegister,
  handleSignIn,
  handleSignOut,
  renderRegister,
  renderSignIn,
} from "./handlers.tsx";

declare module "@blenny/types" {
  interface BlennyEvents {
    "auth:signin": { userId: string; timestamp: number };
    "auth:signout": { userId: string; timestamp: number };
  }
}

const authModule: BlennyModule = {
  name: "form-auth",
  capabilities: ["auth"],
  routes: [
    { method: "GET", path: "/auth/signin", handler: (c) => renderSignIn(c) },
    { method: "POST", path: "/auth/signin", handler: handleSignIn },
    {
      method: "GET",
      path: "/auth/register",
      handler: (c) => renderRegister(c),
    },
    { method: "POST", path: "/auth/register", handler: handleRegister },
    { method: "POST", path: "/auth/signout", handler: handleSignOut },
    {
      method: "POST",
      path: "/auth/avatar",
      handler: handleAvatarUpload,
      auth: true,
    },
    { method: "GET", path: "/avatars/:userId", handler: handleAvatarServe },
  ],
  async initialize(state_: AppState) {
    state.conduit = state_.conduit;
    state.config = {
      jwtSecret: state_.config.jwtSecret,
      cookieName: state_.config.cookieName,
      sessionExpiry: state_.config.sessionDurationHours * 3600,
      secureCookies: !state_.config.devMode,
      allowQueryToken: false,
      logger: state_.logger,
    };

    const driver = state_.config.at("form-auth.store") ?? "memory";
    if (driver === "kv") {
      const dbPath = state_.config.at("form-auth.db.path") || undefined;
      const stores = await openKvStore(dbPath);
      state.store = stores.store;
      state.blobStore = stores.blobStore;
      state.kv = stores.kv;
    } else {
      state.store = createInMemoryUserStore();
      state.blobStore = new FsBlobStore();
    }

    state_.auth = {
      config: state.config,
      middleware: createAuthMiddleware(state.config),
      requireUser: requireUser(),
      requireRole: requireRole,
    };

    const existing = await state.store.findByUsername("admin");
    if (!existing) {
      await state.store.createUser({
        username: "admin",
        passwordHash: await deriveKey("admin", "admin"),
        displayName: "Administrator",
        role: "admin",
      });
      if (!state_.config.devMode) {
        state_.logger.warn(
          "Default admin credentials (admin/admin) are in use — change them immediately",
        );
      }
    }
  },
  async stop() {
    await state.kv?.close();
  },
};

export default authModule;
