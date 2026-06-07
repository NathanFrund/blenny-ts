import type { Context } from "@hono/hono";
import type { UserInfo } from "../../core/auth.ts";
import {
  clearSessionCookie,
  createToken,
  setSessionCookie,
} from "../../core/auth.ts";
import { publish } from "../../core/hub.ts";
import * as v from "@valibot/valibot";
import { PasswordSchema, UsernameSchema } from "../../core/validation.ts";
import { deriveKey, verifyKey } from "./crypto.ts";
import { RegisterPage, SignInPage } from "./ui.tsx";
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

async function handleAvatarUpload(c: Context): Promise<Response> {
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

  const key = await state.blobStore.set("avatars", user.id, file);
  await state.store.updateAvatarKey(user.id, key);

  return c.json({ ok: true, key });
}

async function handleAvatarServe(c: Context): Promise<Response> {
  const userId = c.req.param("userId");
  if (!userId) return c.json({ error: "Missing userId" }, 400);

  const user = await state.store.findById(userId);
  if (!user?.avatarKey) {
    return c.json({ error: "No avatar found" }, 404);
  }

  return state.blobStore.getAsResponse("avatars", userId);
}

export {
  handleAvatarServe,
  handleAvatarUpload,
  handleRegister,
  handleSignIn,
  handleSignOut,
  renderRegister,
  renderSignIn,
};
