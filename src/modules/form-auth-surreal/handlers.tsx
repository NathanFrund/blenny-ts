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

  const [isValid] = await state.db!.query<[boolean]>(
    "RETURN crypto::argon2::compare($hash, $password)",
    { hash: user.passwordHash, password },
  );
  if (!isValid) {
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

  const user = await state.store.createUser({
    username,
    passwordHash: password,
    salt: "",
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
      error={error}
    />,
  );
}

async function handleAvatarUpload(c: Context): Promise<Response> {
  const user = c.get("user") as UserInfo | undefined;
  if (!user) return c.redirect("/auth/signin");

  const form = await c.req.parseBody();
  const file = form.avatar;

  if (!(file instanceof File)) {
    return c.redirect(`/auth/profile?error=${encodeURIComponent("avatar field must be a file")}`);
  }

  if (!file.type.startsWith("image/")) {
    return c.redirect(`/auth/profile?error=${encodeURIComponent("Only image files are accepted")}`);
  }

  const db = state.db!;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const filePath = `avatars:/${user.id}`;
  await db.query(`f'${filePath}'.put($bytes)`, { bytes });
  await db.query(
    "UPDATE user MERGE { avatarKey: $key, avatarMimeType: $mime } WHERE uuid = $uuid",
    { uuid: user.id, key: `avatars:${user.id}`, mime: file.type },
  );

  return c.redirect("/auth/profile");
}

async function handleAvatarServe(c: Context): Promise<Response> {
  const userId = c.req.param("userId");
  if (!userId) return c.json({ error: "Missing userId" }, 400);

  const db = state.db!;

  const result = await db.query(
    "SELECT avatarKey, avatarMimeType FROM user WHERE uuid = $uuid",
    { uuid: userId },
  );
  const [rows] = result as unknown as [{ avatarKey?: string; avatarMimeType?: string }[]];
  const record = rows?.[0];

  if (!record?.avatarKey) {
    return c.json({ error: "No avatar found" }, 404);
  }

  const filePath = `avatars:/${userId}`;
  const fileResult = await db.query(`f'${filePath}'.get()`);

  const raw = fileResult?.[0];

  let blob: Uint8Array;
  if (raw instanceof Uint8Array) {
    blob = raw;
  } else if (raw instanceof ArrayBuffer) {
    blob = new Uint8Array(raw);
  } else if (Array.isArray(raw) && raw[0] instanceof Uint8Array) {
    blob = raw[0];
  } else if (Array.isArray(raw) && raw[0] instanceof ArrayBuffer) {
    blob = new Uint8Array(raw[0]);
  } else {
    return c.json({ error: "Avatar data not found" }, 404);
  }

  return new Response(blob, {
    headers: { "Content-Type": record.avatarMimeType ?? "application/octet-stream" },
  });
}

export {
  handleAvatarServe,
  handleAvatarUpload,
  handleProfile,
  handleRegister,
  handleSignIn,
  handleSignOut,
  renderRegister,
  renderSignIn,
};
