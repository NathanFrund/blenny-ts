import type { Context } from "@hono/hono";
import { getCookie, setCookie } from "@hono/hono/cookie";

const CSRF_COOKIE = "csrf";
const TOKEN_BYTES = 32;

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function csrfToken(c: Context): string {
  const token = generateToken();
  setCookie(c, CSRF_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 3600,
  });
  return token;
}

export function csrfGuard(
  c: Context,
  body: Record<string, unknown>,
): Response | null {
  const cookieValue = getCookie(c, CSRF_COOKIE);
  if (!cookieValue) {
    return c.json({ error: "Missing CSRF token" }, 403);
  }
  if (cookieValue !== body["_csrf"]) {
    return c.json({ error: "Invalid CSRF token" }, 403);
  }
  return null;
}
