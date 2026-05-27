import type { Context, Next } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";

export function createRequestSizeLimit(maxBytes: number): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const cl = c.req.header("content-length");
    if (cl) {
      const bytes = parseInt(cl, 10);
      if (bytes > maxBytes) {
        return c.json(
          {
            error: {
              type: "request_too_large",
              message: "Request body too large",
            },
          },
          413,
        );
      }
    }
    await next();
  };
}
