import type { Context, Next } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import type { BlennyConfig } from "./config.ts";
import type { BlennyLogger } from "./logger.ts";

interface RateLimitEntry {
  count: number;
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
  return "unknown";
}

function parseWindowIndex(key: string): number {
  return Number(key.split(":").at(-1));
}

export function createRateLimiter(
  config: BlennyConfig,
  logger?: BlennyLogger,
): MiddlewareHandler {
  const WINDOW_MS = Number(config.at("ratelimit.window_ms") ?? "60000");
  const MAX_REQUESTS = Number(config.at("ratelimit.max_requests") ?? "30");
  const store = new Map<string, RateLimitEntry>();

  // Periodic cleanup: remove entries whose window index is stale
  setInterval(() => {
    const currentWindow = Math.floor(Date.now() / WINDOW_MS);
    for (const [key] of store) {
      if (parseWindowIndex(key) < currentWindow) {
        store.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);

  return async (c: Context, next: Next) => {
    const ip = getClientIP(c);
    const now = Date.now();
    const windowIndex = Math.floor(now / WINDOW_MS);
    const windowKey = `${ip}:${windowIndex}`;

    let entry = store.get(windowKey);
    if (!entry) {
      entry = { count: 0 };
      store.set(windowKey, entry);
    }

    entry.count++;
    if (entry.count > MAX_REQUESTS) {
      const nextWindowStart = (windowIndex + 1) * WINDOW_MS;
      const retryAfter = Math.ceil((nextWindowStart - now) / 1000);
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
