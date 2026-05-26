import { Context, type MiddlewareHandler } from "@hono/hono";
import { sign, verify } from "@hono/hono/jwt";
import { getCookie, setCookie, deleteCookie } from "@hono/hono/cookie";

export interface AuthConfig {
  jwtSecret: string;
  cookieName: string;
  sessionExpiry: number;
}

export interface UserInfo {
  id: string;
  role: string;
}

// ── Token helpers ──────────────────────────────────────────

export async function createToken(
  user: UserInfo,
  config: AuthConfig,
): Promise<string> {
  return await sign(
    { ...user, exp: Math.floor(Date.now() / 1000) + config.sessionExpiry },
    config.jwtSecret,
  );
}

export async function getUser(
  c: Context,
  config: AuthConfig,
): Promise<UserInfo | null> {
  const token = getCookie(c, config.cookieName) ??
    c.req.query("token");
  if (!token) return null;
  try {
    return await verify(token, config.jwtSecret, "HS256") as unknown as UserInfo;
  } catch {
    return null;
  }
}

// ── Middleware factories ────────────────────────────────────

export function createAuthMiddleware(config: AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    const user = await getUser(c, config);
    if (user) c.set("user", user);
    await next();
  };
}

export function requireUser(): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as UserInfo | undefined;
    if (!user) return c.redirect("/auth/signin");
    await next();
  };
}

export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as UserInfo | undefined;
    if (!user) return c.redirect("/auth/signin");
    if (!roles.includes(user.role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

// ── Cookie helpers ──────────────────────────────────────────

export function setSessionCookie(
  c: Context,
  token: string,
  config: AuthConfig,
): void {
  setCookie(c, config.cookieName, token, {
    path: "/",
    httpOnly: true,
    maxAge: config.sessionExpiry,
  });
}

export function clearSessionCookie(c: Context, config: AuthConfig): void {
  deleteCookie(c, config.cookieName, { path: "/" });
}
