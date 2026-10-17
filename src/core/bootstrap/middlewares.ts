import type { Hono } from "@hono/hono";
import { bodyLimit } from "@hono/hono/body-limit";
import { cors } from "@hono/hono/cors";
import { csrf } from "@hono/hono/csrf";
import { HTTPException } from "@hono/hono/http-exception";
import { secureHeaders } from "@hono/hono/secure-headers";
import type { BlennyConfig } from "../config.ts";
import { BlennyError, errorResponse } from "../error.ts";
import { publish } from "../hub.ts";
import { requestLogger } from "../logger.ts";
import { createRateLimiter } from "../rate-limiter.ts";
import { SpanStatusCode, trace } from "../tracing.ts";

const HTTP_STATUS_ERRORS: Record<number, { type: string; message: string }> = {
  400: { type: "bad_request", message: "Bad Request" },
  401: { type: "unauthorized", message: "Unauthorized" },
  403: { type: "forbidden", message: "Forbidden" },
  404: { type: "not_found", message: "Not Found" },
  405: { type: "method_not_allowed", message: "Method Not Allowed" },
  413: { type: "request_too_large", message: "Request body too large" },
  429: { type: "rate_limited", message: "Too Many Requests" },
};

export function configureMiddleware(app: Hono, config: BlennyConfig): void {
  app.use(requestLogger());
  app.use(secureHeaders());
  app.use(cors({ origin: config.corsOrigin }));
  app.use("*", csrf());

  const transportLimiter = createRateLimiter(config.ratelimitWindowMs, config.ratelimitMaxRequests, config.trustProxy);
  const authLimiter = createRateLimiter(
    config.ratelimitAuthWindowMs,
    config.ratelimitAuthMaxRequests,
    config.trustProxy,
  );
  app.use("/sse", transportLimiter);
  app.use("/ws", transportLimiter);
  app.use("/auth/*", authLimiter);

  app.use(
    bodyLimit({
      maxSize: config.maxBodyBytes,
      onError: (c) =>
        c.json(
          {
            error: { type: "request_too_large", message: "Request body too large" },
          },
          413,
        ),
    }),
  );
}

export function createErrorHandler(app: Hono): void {
  app.onError((err, _c) => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.recordException(err);
    }
    if (err instanceof BlennyError) {
      return errorResponse(err.toJSON(), err.statusCode);
    }
    if (err instanceof HTTPException) {
      const known = HTTP_STATUS_ERRORS[err.status];
      return errorResponse(
        {
          error: {
            type: known?.type ?? "http_error",
            message: err.message || known?.message || `HTTP ${err.status}`,
          },
        },
        err.status,
      );
    }
    publish("log", {
      level: "error",
      template: "Uncaught error",
      error: err,
    });
    return errorResponse({ error: { type: "internal", message: "Internal Server Error" } }, 500);
  });
}

export function createNotFoundHandler(app: Hono): void {
  app.notFound((_c) => {
    return errorResponse({ error: { type: "not_found", message: "Not Found" } }, 404);
  });
}
