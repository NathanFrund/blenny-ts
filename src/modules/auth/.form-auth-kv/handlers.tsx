import type { Context } from "@hono/hono";
import type { UserInfo } from "@blenny/core/auth.ts";
import {
  clearSessionCookie,
  createToken,
  setSessionCookie,
} from "@blenny/core/auth.ts";
import { publish } from "@blenny/core/hub.ts";
import * as v from "@valibot/valibot";
import { PasswordSchema, UsernameSchema } from "@blenny/core/validation.ts";
import { deriveKey, verifyKey } from "./crypto.ts";
import { ProfilePage, RegisterPage, SignInPage } from "./ui.tsx";
import { state } from "./state.ts";

function renderSignIn(
  c: Context,
  error?: string,
): Response | Promise<Response> {
  return state.conduit.respond(
    c,
    <SignInPage error={error} />,
  );
}

async function handleSignIn(c: Context): Promise<Response> {
  const body = await c.req.parseBody();
  const username = body.username as string;
  const password = body.password as string;

  const user = await state.store.findByUsername(username);
  if (!user) {
    return renderSignIn(c, "Invalid username or password");
  }

  const hash = await verifyKey(password, user.salt);
  if (user.passwordHash !== hash) {
    return renderSignIn(c, "Invalid username or password");
  }

  const token = await createToken(
    { id: user.id, role: user.role },
    state.config,
  );

  const redirectTo = c.req.query("redirect_to") || "/dashboard";
  setSessionCookie(c, token, state.config);

  await publish("auth:signin", { userId: user.id, timestamp: Date.now() });

  return c.redirect(redirectTo);
}

function renderRegister(
  c: Context,
  error?: string,
): Response | Promise<Response> {
  return state.conduit.respond(
    c,
    <RegisterPage error={error} />,
  );
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

  const { hash, salt } = await deriveKey(password);
  const user = await state.store.createUser({
    username,
    passwordHash: hash,
    salt,
    displayName,
    role: "user",
  }).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : "Registration failed";
    return renderRegister(c, msg);
  });

  if (user instanceof Response) return user;

  const token = await createToken(
    { id: user.id, role: user.role },
    state.config,
  );

  const redirectTo = c.req.query("redirect_to") || "/dashboard";
  setSessionCookie(c, token, state.config);

  await publish("auth:signin", { userId: user.id, timestamp: Date.now() });

  return c.redirect(redirectTo);
}

async function handleSignOut(c: Context): Promise<Response> {
  const user = c.get("user") as UserInfo | undefined;
  clearSessionCookie(c, state.config);

  if (user) {
    await publish("auth:signout", { userId: user.id, timestamp: Date.now() });
  }

  return c.redirect("/");
}

async function handleProfile(c: Context): Promise<Response> {
  const userInfo = c.get("user") as UserInfo | undefined;
  if (!userInfo) return c.redirect("/auth/signin");

  const user = await state.store.findById(userInfo.id);
  if (!user) return c.redirect("/auth/signin");

  const error = c.req.query("error");
  return state.conduit.respond(
    c,
    <ProfilePage
      id={user.id}
      username={user.username}
      displayName={user.displayName}
      role={user.role}
      avatarKey={user.avatarKey}
      userInfo={userInfo}
      error={error}
    />,
  );
}

export {
  handleProfile,
  handleRegister,
  handleSignIn,
  handleSignOut,
  renderRegister,
  renderSignIn,
};
