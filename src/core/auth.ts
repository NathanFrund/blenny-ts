import { Context, type MiddlewareHandler } from "@hono/hono";
import { sign, verify } from "@hono/hono/jwt";
import { deleteCookie, getCookie, setCookie } from "@hono/hono/cookie";
import * as v from "@valibot/valibot";
import { UserInfoSchema } from "./validation.ts";
import { publish } from "./hub.ts";
import { withSpan } from "./tracing.ts";

// ── Types ─────────────────────────────────────────────────────

export interface AuthConfig {
  jwtSecret: string;
  cookieName: string;
  sessionExpiry: number;
  secureCookies?: boolean;
  allowQueryToken?: boolean;
  redirectUrl?: string;
  useJsonForApi?: boolean;
}

export interface UserInfo {
  id: string;
  role: string;
  roles?: string[];
  effectiveRoles?: string[];
}

// ── Token helpers ─────────────────────────────────────────────

export function createToken(
  user: UserInfo,
  config: AuthConfig,
): Promise<string> {
  return withSpan("auth.createToken", async (_span) => {
    return await sign(
      { ...user, exp: Math.floor(Date.now() / 1000) + config.sessionExpiry },
      config.jwtSecret,
    );
  });
}

export function getUser(
  c: Context,
  config: AuthConfig,
): Promise<UserInfo | null> {
  return withSpan("auth.getUser", async (_span) => {
    let token = getCookie(c, config.cookieName);

    if (!token && config.allowQueryToken === true) {
      token = c.req.query("token");
    }

    if (!token) return null;

    try {
      const payload = await verify(token, config.jwtSecret, "HS256");
      const result = v.safeParse(UserInfoSchema, payload);
      if (!result.success) {
        publish("log", {
          level: "debug",
          template: "Invalid JWT payload structure",
          args: { errors: result.issues },
        });
        return null;
      }
      return {
        id: result.output.id,
        role: result.output.role,
        roles: result.output.roles ?? [result.output.role],
      };
    } catch {
      return null;
    }
  });
}

// ── Middleware factories ──────────────────────────────────────

export function createAuthMiddleware(config: AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    c.set("authConfig", config);
    const user = await getUser(c, config);
    if (user) c.set("user", user);
    await next();
  };
}

function shouldReturnJson(c: Context, config: AuthConfig): boolean {
  if (config.useJsonForApi === true) {
    const accept = c.req.header("Accept") || "";
    return accept.includes("application/json") || !accept.includes("text/html");
  }
  const path = c.req.path;
  if (path.startsWith("/api/") || path.startsWith("/json/")) {
    return true;
  }
  return false;
}

export function requireUser(
  options?: { redirectUrl?: string },
): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as UserInfo | undefined;
    const authConfig = c.get("authConfig") as AuthConfig | undefined;
    if (!user) {
      if (authConfig && shouldReturnJson(c, authConfig)) {
        return c.json({
          error: "unauthorized",
          message: "Authentication required",
        }, 401);
      }
      const redirect = options?.redirectUrl ?? authConfig?.redirectUrl ??
        "/auth/signin";
      return c.redirect(redirect);
    }
    await next();
  };
}

export function requireRole(...roles: string[]): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user") as UserInfo | undefined;
    const authConfig = c.get("authConfig") as AuthConfig | undefined;
    if (!user) {
      if (authConfig && shouldReturnJson(c, authConfig)) {
        return c.json({
          error: "unauthorized",
          message: "Authentication required",
        }, 401);
      }
      const redirect = authConfig?.redirectUrl ?? "/auth/signin";
      return c.redirect(redirect);
    }
    if (!roles.includes(user.role)) {
      return c.json({ error: "forbidden", message: "Insufficient role" }, 403);
    }
    await next();
  };
}

// ── Cookie helpers ────────────────────────────────────────────

export function setSessionCookie(
  c: Context,
  token: string,
  config: AuthConfig,
): void {
  setCookie(c, config.cookieName, token, {
    path: "/",
    httpOnly: true,
    maxAge: config.sessionExpiry,
    secure: config.secureCookies ?? false,
    sameSite: "lax",
  });
}

export function clearSessionCookie(c: Context, config: AuthConfig): void {
  deleteCookie(c, config.cookieName, { path: "/" });
}
