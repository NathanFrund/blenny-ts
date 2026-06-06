import type { Context, Next } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { publish } from "./hub.ts";

interface RateLimitEntry {
  count: number;
}

function getClientIP(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const ip = forwarded.split(",")[0]?.trim();
      if (ip) return ip;
    }
    const realIp = c.req.header("x-real-ip");
    if (realIp) return realIp;
  }

  try {
    const info = c.env as { remoteAddr?: Deno.NetAddr } | undefined;
    if (info?.remoteAddr?.hostname) {
      return info.remoteAddr.hostname;
    }
  } catch {
    // env access may fail in some environments
  }

  return "unknown";
}

function parseWindowIndex(key: string): number {
  return Number(key.split(":").at(-1));
}

export function createRateLimiter(
  windowMs: number,
  maxRequests: number,
  cleanupIntervalMs = 60_000,
  trustProxy = false,
): MiddlewareHandler {
  const store = new Map<string, RateLimitEntry>();

  setInterval(() => {
    const currentWindow = Math.floor(Date.now() / windowMs);
    for (const [key] of store) {
      if (parseWindowIndex(key) < currentWindow) {
        store.delete(key);
      }
    }
  }, cleanupIntervalMs);

  return async (c: Context, next: Next) => {
    const ip = getClientIP(c, trustProxy);
    const now = Date.now();
    const windowIndex = Math.floor(now / windowMs);
    const windowKey = `${ip}:${windowIndex}`;

    let entry = store.get(windowKey);
    if (!entry) {
      entry = { count: 1 };
      store.set(windowKey, entry);
    } else {
      entry.count++;
    }

    if (entry.count > maxRequests) {
      const nextWindowStart = (windowIndex + 1) * windowMs;
      const retryAfter = Math.ceil((nextWindowStart - now) / 1000);
      c.header("Retry-After", String(retryAfter));
      publish("log", {
        level: "warn",
        template: "Rate limit exceeded for IP {ip}",
        args: { ip },
      });
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
