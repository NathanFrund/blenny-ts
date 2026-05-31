import type { FC } from "@hono/hono/jsx";
import type { Context } from "@hono/hono";
import type { Conduit } from "../core/conduit.ts";
import type { AuthConfig, UserInfo } from "../core/auth.ts";
import {
  clearSessionCookie,
  createAuthMiddleware,
  createToken,
  requireRole,
  requireUser,
  setSessionCookie,
} from "../core/auth.ts";
import { publish } from "../core/hub.ts";
import type { AppState } from "../core/app-state.ts";
import type { BlennyEvents as _BlennyEvents } from "../types.ts";
import type { BlobStore, UserStore } from "../core/store.ts";
import { openKvStore } from "../core/kv-store.ts";
import { createInMemoryUserStore } from "../core/user-store.ts";
import * as v from "@valibot/valibot";
import { PasswordSchema, UsernameSchema } from "../core/validation.ts";

declare module "../types.ts" {
  interface BlennyEvents {
    "auth:signin": { userId: string; timestamp: number };
    "auth:signout": { userId: string; timestamp: number };
  }
}
import type { BlennyModule } from "../types.ts";

// ── PBKDF2 ─────────────────────────────────────────────────────

async function deriveKey(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Module state ────────────────────────────────────────────────

let store: UserStore;
let blobStore: BlobStore | undefined;
let kv: Deno.Kv | undefined;
let conduit: Conduit;
let config: AuthConfig;

// ── Pages ────────────────────────────────────────────────────

const SignInPage: FC<{ error?: string }> = (props) => (
  <div>
    <h1>Sign In</h1>
    {props.error && <p style="color:red">{props.error}</p>}
    <form method="post" action="/auth/signin">
      <label>
        Username
        <input type="text" name="username" required />
      </label>
      <br />
      <label>
        Password
        <input type="password" name="password" required />
      </label>
      <br />
      <button type="submit">Sign In</button>
    </form>
    <p>
      <a href="/auth/register">Create an account</a>
    </p>
  </div>
);

const RegisterPage: FC<{ error?: string }> = (props) => (
  <div>
    <h1>Register</h1>
    {props.error && <p style="color:red">{props.error}</p>}
    <form method="post" action="/auth/register">
      <label>
        Username
        <input type="text" name="username" required />
      </label>
      <br />
      <label>
        Display Name
        <input type="text" name="display_name" required />
      </label>
      <br />
      <label>
        Password
        <input type="password" name="password" required />
      </label>
      <br />
      <button type="submit">Register</button>
    </form>
    <p>
      <a href="/auth/signin">Already have an account?</a>
    </p>
  </div>
);

// ── Sign-in ────────────────────────────────────────────────────

function renderSignIn(
  c: Context,
  error?: string,
): Response | Promise<Response> {
  return conduit.respond(c, <SignInPage error={error} />);
}

async function handleSignIn(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const username = body.username as string;
  const password = body.password as string;

  const user = await store.findByUsername(username);
  if (!user) {
    return renderSignIn(c, "Invalid username or password");
  }

  const hash = await deriveKey(password, user.username);
  if (user.passwordHash !== hash) {
    return renderSignIn(c, "Invalid username or password");
  }

  const token = await createToken(
    { id: user.id, role: user.role },
    config,
  );

  const redirectTo = c.req.query("redirect_to") || "/dashboard";
  setSessionCookie(c, token, config);

  publish("auth:signin", { userId: user.id, timestamp: Date.now() });

  return c.redirect(redirectTo);
}

// ── Registration ──────────────────────────────────────────────

function renderRegister(
  c: Context,
  error?: string,
): Response | Promise<Response> {
  return conduit.respond(c, <RegisterPage error={error} />);
}

async function handleRegister(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const username = (body.username as string).trim();
  const displayName = (body.display_name as string).trim();
  const password = body.password as string;

  const usernameResult = v.safeParse(UsernameSchema, username);
  const passwordResult = v.safeParse(PasswordSchema, password);
  if (!usernameResult.success) {
    return renderRegister(c, usernameResult.issues[0].message);
  }
  if (!passwordResult.success) {
    return renderRegister(c, passwordResult.issues[0].message);
  }
  if (!displayName) {
    return renderRegister(c, "Display name is required");
  }

  const user = await store.createUser({
    username,
    passwordHash: await deriveKey(password, username),
    displayName,
    role: "user",
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Registration failed";
    return renderRegister(c, msg);
  });

  if (user instanceof Response) return user;

  const token = await createToken(
    { id: user.id, role: user.role },
    config,
  );

  const redirectTo = c.req.query("redirect_to") || "/dashboard";
  setSessionCookie(c, token, config);

  publish("auth:signin", { userId: user.id, timestamp: Date.now() });

  return c.redirect(redirectTo);
}

// ── Sign-out ───────────────────────────────────────────────────

function handleSignOut(c: Context): Response {
  const token = c.get("user") as UserInfo | undefined;
  clearSessionCookie(c, config);

  if (token) {
    publish("auth:signout", { userId: token.id, timestamp: Date.now() });
  }

  return c.redirect("/");
}

// ── Avatar upload ───────────────────────────────────────────────
// POST /auth/avatar  multipart/form-data  field: "avatar" (File)

async function handleAvatarUpload(c: Context): Promise<Response> {
  if (!blobStore) {
    return c.json(
      { error: "Avatar storage requires KV mode (form-auth.store = 'kv')" },
      501,
    );
  }

  const user = c.get("user") as UserInfo | undefined;
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const form = await c.req.parseBody();
  const file = form.avatar;

  if (!(file instanceof File)) {
    return c.json({ error: "avatar field must be a file" }, 400);
  }

  if (!file.type.startsWith("image/")) {
    return c.json({ error: "Only image files are accepted" }, 415);
  }

  const key = await blobStore.set("avatars", user.id, file);
  await store.updateAvatarKey(user.id, key);

  return c.json({ ok: true, key });
}

// ── Avatar serving ──────────────────────────────────────────────
// GET /avatars/:userId

async function handleAvatarServe(c: Context): Promise<Response> {
  if (!blobStore) {
    return c.json({ error: "No avatar found" }, 404);
  }

  const userId = c.req.param("userId");
  if (!userId) return c.json({ error: "Missing userId" }, 400);

  const user = await store.findById(userId);
  if (!user?.avatarKey) {
    return c.json({ error: "No avatar found" }, 404);
  }

  return blobStore.getAsResponse("avatars", userId);
}

// ── Module ─────────────────────────────────────────────────────

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
  async initialize(state: AppState) {
    conduit = state.conduit;
    config = {
      jwtSecret: state.config.jwtSecret,
      cookieName: state.config.cookieName,
      sessionExpiry: state.config.sessionDurationHours * 3600,
      secureCookies: !state.config.devMode,
      allowQueryToken: false,
      logger: state.logger,
    };

    const driver = state.config.at("form-auth.store") ?? "memory";
    if (driver === "kv") {
      const stores = await openKvStore(state.config.at("form-auth.db.path"));
      store = stores.store;
      blobStore = stores.blobStore;
      kv = stores.kv;
    } else {
      store = createInMemoryUserStore();
    }

    state.auth = {
      config,
      middleware: createAuthMiddleware(config),
      requireUser: requireUser(),
      requireRole: requireRole,
    };

    const existing = await store.findByUsername("admin");
    if (!existing) {
      await store.createUser({
        username: "admin",
        passwordHash: await deriveKey("admin", "admin"),
        displayName: "Administrator",
        role: "admin",
      });
      if (!state.config.devMode) {
        state.logger.warn(
          "Default admin credentials (admin/admin) are in use — change them immediately",
        );
      }
    }
  },

  async stop() {
    await kv?.close();
  },
};

export default authModule;
