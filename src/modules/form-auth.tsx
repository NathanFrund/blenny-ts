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
import { publish } from "../core/hub.ts";
import type { AppState } from "../core/app-state.ts";
import type { BlennyModule } from "../types.ts";

let conduit: Conduit;
let config: AuthConfig;

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
  </div>
);

function renderSignIn(c: Context, error?: string): Response | Promise<Response> {
  return conduit.respond(c, <SignInPage error={error} />);
}

async function handleSignIn(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const username = body.username as string;
  const password = body.password as string;

  if (username !== "admin" || password !== "admin") {
    return renderSignIn(c, "Invalid username or password");
  }

  const user: UserInfo = { id: "admin", role: "admin" };
  const token = await createToken(user, config);

  const redirectTo = c.req.query("redirect_to") || "/dashboard";
  setSessionCookie(c, token, config);

  publish("auth:signin", { userId: user.id, timestamp: Date.now() });

  return c.redirect(redirectTo);
}

function handleSignOut(c: Context): Response {
  clearSessionCookie(c, config);

  publish("auth:signout", { userId: "admin", timestamp: Date.now() });

  return c.redirect("/");
}

const authModule: BlennyModule = {
  name: "form-auth",
  routes: [
    { method: "GET", path: "/auth/signin", handler: (c) => renderSignIn(c) },
    { method: "POST", path: "/auth/signin", handler: handleSignIn },
    { method: "POST", path: "/auth/signout", handler: handleSignOut },
  ],
  initialize(state: AppState) {
    conduit = state.conduit;
    config = {
      jwtSecret: state.config.jwtSecret,
      cookieName: state.config.cookieName,
      sessionExpiry: state.config.sessionDurationHours * 3600,
    };
    state.auth = {
      config,
      middleware: createAuthMiddleware(config),
      requireUser: requireUser(),
      requireRole: requireRole,
    };
  },
};

export default authModule;
