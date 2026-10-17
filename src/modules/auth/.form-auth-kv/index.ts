import type { AppState } from "@blenny/core/app-state.ts";
import { createAuthMiddleware, requireRole, requireUser } from "@blenny/core/auth.ts";
import { FsBlobStore } from "@blenny/core/fs-blob-store.ts";
import { publish } from "@blenny/core/hub.ts";
import { openSqliteStore } from "@blenny/core/sqlite-store.ts";
import { createInMemoryUserStore } from "@blenny/core/user-store.ts";
import { BlobStoreAvatarService } from "@blenny/lib/avatar/blob-store.ts";
import { createHandleAvatarServe, createHandleAvatarUpload } from "@blenny/lib/avatar/handlers.ts";
import type { BlennyModule } from "@blenny/types";
import { deriveKey } from "./crypto.ts";
import {
  handleProfile,
  handleRegister,
  handleSignIn,
  handleSignOut,
  renderRegister,
  renderSignIn,
} from "./handlers.tsx";
import { state } from "./state.ts";

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
      method: "GET",
      path: "/auth/profile",
      handler: handleProfile,
      auth: true,
    },
    {
      method: "POST",
      path: "/auth/avatar",
      handler: (c) => state.handleAvatarUpload!(c),
      auth: true,
    },
    {
      method: "GET",
      path: "/avatars/:userId",
      handler: (c) => state.handleAvatarServe!(c),
    },
  ],
  async initialize(state_: AppState) {
    state.conduit = state_.conduit;
    state.config = {
      jwtSecret: state_.config.jwtSecret,
      cookieName: state_.config.cookieName,
      sessionExpiry: state_.config.sessionDurationHours * 3600,
      secureCookies: !state_.config.devMode,
      allowQueryToken: false,
    };

    const driver = state_.config.at("form-auth.store") ?? "memory";
    if (driver === "sqlite" || driver === "kv") {
      const dbPath = state_.config.at("form-auth.db.path") || "./data/blenny.sqlite";
      const blobStore = new FsBlobStore();
      const stores = openSqliteStore(dbPath, blobStore);
      state.store = stores.store;
      state.blobStore = stores.blobStore;
      state.db = stores.db;
    } else {
      state.store = createInMemoryUserStore();
      state.blobStore = new FsBlobStore();
    }

    const avatarSvc = new BlobStoreAvatarService(state.blobStore);
    state.deps = {
      store: state.store,
      avatarService: avatarSvc,
      blobStore: state.blobStore,
    };
    state.handleAvatarUpload = createHandleAvatarUpload(state.deps);
    state.handleAvatarServe = createHandleAvatarServe(state.deps);

    state_.store = state.store;
    state_.auth = {
      config: state.config,
      middleware: createAuthMiddleware(state.config),
      requireUser: requireUser(),
      requireRole: requireRole,
    };

    const existing = await state.store.findByUsername("admin");
    if (!existing) {
      const { hash, salt } = await deriveKey("admin");
      await state.store.createUser({
        username: "admin",
        passwordHash: hash,
        salt,
        displayName: "Administrator",
        role: "admin",
      });
      if (!state_.config.devMode) {
        publish("log", {
          level: "warn",
          template: "Default admin credentials (admin/admin) are in use — change them immediately",
        });
      }
    }
  },
  async stop() {
    state.db?.close();
  },
};

export default authModule;
