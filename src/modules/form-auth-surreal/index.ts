import type { AppState } from "../../core/app-state.ts";
import {
  createAuthMiddleware,
  requireRole,
  requireUser,
} from "../../core/auth.ts";
import { requireDb } from "../../core/db-guard.ts";
import { SurrealUserStore } from "../../core/surreal-store.ts";
import { publish } from "../../core/hub.ts";
import type { BlennyModule } from "../../types.ts";
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
  name: "form-auth-surreal",
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
    };

    const db = requireDb(state_.db, "form-auth-surreal");
    state.db = db;

    const store = new SurrealUserStore(db);
    await store.setup();

    const backend = state_.config.at("form-auth.bucket.backend") ?? "memory";
    try {
      await db.query(
        "DEFINE BUCKET IF NOT EXISTS avatars BACKEND $backend",
        { backend },
      );
    } catch (err) {
      publish("log", {
        level: "warn",
        template: "Avatar bucket not available (enable --experimental-files on SurrealDB): {error}",
        args: { error: String(err) },
      });
    }

    state.store = store;

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
        passwordHash: "admin",
        salt: "",
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
    // Connection lifecycle managed by core — no close needed here
  },
};

export default authModule;
