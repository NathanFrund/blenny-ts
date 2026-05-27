import type { Context, Next } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import type { BlennyConfig } from "./config.ts";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createRateLimiter(config: BlennyConfig): MiddlewareHandler {
  const WINDOW_MS = Number(config.at("ratelimit.window_ms") ?? "60000");
  const MAX_REQUESTS = Number(config.at("ratelimit.max_requests") ?? "30");
  const store = new Map<string, RateLimitEntry>();

  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
      || c.req.header("x-real-ip")
      || "unknown";
    const now = Date.now();
    const windowKey = `${ip}:${Math.floor(now / WINDOW_MS)}`;

    let entry = store.get(windowKey);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + WINDOW_MS };
      store.set(windowKey, entry);
    }

    entry.count++;
    if (entry.count > MAX_REQUESTS) {
      c.header("Retry-After", String(Math.ceil(WINDOW_MS / 1000)));
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
