import type { FC } from "@hono/hono/jsx";
import type { Context } from "@hono/hono";
import type { Conduit } from "../core/conduit.ts";
import type { AuthConfig, UserInfo } from "../core/auth.ts";
import {
  createToken,
  createAuthMiddleware,
  requireUser,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
} from "../core/auth.ts";
import { createUserStore } from "../core/user-store.ts";
import { publish } from "../core/hub.ts";
import type { AppState } from "../core/app-state.ts";
import type { BlennyEvents } from "../types.ts";

declare module "../types.ts" {
  interface BlennyEvents {
    "auth:signin": { userId: string; timestamp: number };
    "auth:signout": { userId: string; timestamp: number };
  }
}
import type { BlennyModule } from "../types.ts";

let conduit: Conduit;
let config: AuthConfig;
const userStore = createUserStore();

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

function renderSignIn(c: Context, error?: string): Response | Promise<Response> {
  return conduit.respond(c, <SignInPage error={error} />);
}

async function handleSignIn(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const username = body.username as string;
  const password = body.password as string;

  const user = await userStore.verifyPassword(username, password);
  if (!user) {
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

  if (!username || !displayName || !password) {
    return renderRegister(c, "All fields are required");
  }

  const user = await userStore.createUser(username, password, displayName);
  if (!user) {
    return renderRegister(c, "Username is already taken");
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

// ── Sign-out ───────────────────────────────────────────────────

function handleSignOut(c: Context): Response {
  const token = c.get("user") as UserInfo | undefined;
  clearSessionCookie(c, config);

  if (token) {
    publish("auth:signout", { userId: token.id, timestamp: Date.now() });
  }

  return c.redirect("/");
}

// ── Module ─────────────────────────────────────────────────────

const authModule: BlennyModule = {
  name: "form-auth",
  routes: [
    { method: "GET", path: "/auth/signin", handler: (c) => renderSignIn(c) },
    { method: "POST", path: "/auth/signin", handler: handleSignIn },
    { method: "GET", path: "/auth/register", handler: (c) => renderRegister(c) },
    { method: "POST", path: "/auth/register", handler: handleRegister },
    { method: "POST", path: "/auth/signout", handler: handleSignOut },
  ],
  async initialize(state: AppState) {
    conduit = state.conduit;
    config = {
      jwtSecret: state.config.jwtSecret,
      cookieName: state.config.cookieName,
      sessionExpiry: state.config.sessionDurationHours * 3600,
      secureCookies: false,
      allowQueryToken: false,
      logger: state.logger,
    };
    state.auth = {
      config,
      middleware: createAuthMiddleware(config),
      requireUser: requireUser(),
      requireRole: requireRole,
    };

    // Seed a default admin user
    const existing = await userStore.findByUsername("admin");
    if (!existing) {
      await userStore.createUser("admin", "admin", "Administrator", "admin");
    }
  },
};

export default authModule;
