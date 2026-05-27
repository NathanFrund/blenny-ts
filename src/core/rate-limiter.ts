import type { Context, Next } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import type { BlennyConfig } from "./config.ts";
import type { BlennyLogger } from "./logger.ts";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const CLEANUP_INTERVAL = 300_000;

function getClientIP(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const ip = forwarded.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp;
  // On direct connections, c.env may contain the remote address
  // from Deno.serve's handler info. Fallback to "unknown".
  return "unknown";
}

export function createRateLimiter(
  config: BlennyConfig,
  logger?: BlennyLogger,
): MiddlewareHandler {
  const WINDOW_MS = Number(config.at("ratelimit.window_ms") ?? "60000");
  const MAX_REQUESTS = Number(config.at("ratelimit.max_requests") ?? "30");
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup to prevent memory leak from abandoned window keys
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.resetAt) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  return async (c: Context, next: Next) => {
    const ip = getClientIP(c);
    const now = Date.now();
    const windowKey = `${ip}:${Math.floor(now / WINDOW_MS)}`;

    let entry = store.get(windowKey);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(windowKey, entry);
    }

    entry.count++;
    if (entry.count > MAX_REQUESTS) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      if (logger) {
        logger.warn("Rate limit exceeded for IP {ip}", { ip });
      }
      return c.json(
        {
          error: {
            type: "too_many_requests",
            message: "Too many requests, try again later.",
          },
        },
        429,
      );
    }

    await next();
  };
}
