import type { Hono } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { bodyLimit } from "@hono/hono/body-limit";
import { csrf } from "@hono/hono/csrf";
import { createRateLimiter } from "../rate-limiter.ts";
import { SpanStatusCode, trace } from "../tracing.ts";
import { BlennyError, errorResponse } from "../error.ts";
import { requestLogger } from "../logger.ts";
import type { BlennyConfig } from "../config.ts";
import type { BlennyLogger } from "../logger.ts";

export function configureMiddleware(
  app: Hono,
  config: BlennyConfig,
  logger: BlennyLogger,
): void {
  app.use(requestLogger(logger));
  app.use(cors({ origin: config.corsOrigin }));
  app.use("*", csrf());

  const transportLimiter = createRateLimiter(
    config.ratelimitWindowMs,
    config.ratelimitMaxRequests,
    60_000,
    logger,
    config.trustProxy,
  );
  const authLimiter = createRateLimiter(
    config.ratelimitAuthWindowMs,
    config.ratelimitAuthMaxRequests,
    60_000,
    logger,
    config.trustProxy,
  );
  app.use("/sse", transportLimiter);
  app.use("/ws", transportLimiter);
  app.use("/auth/*", authLimiter);

  app.use(bodyLimit({
    maxSize: config.maxBodyBytes,
    onError: (c) =>
      c.json({
        error: { type: "request_too_large", message: "Request body too large" },
      }, 413),
  }));
}

export function createErrorHandler(app: Hono, logger: BlennyLogger): void {
  app.onError((err, _c) => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      span.recordException(err);
    }
    if (err instanceof BlennyError) {
      return errorResponse(err.toJSON(), err.statusCode);
    }
    logger.error("Uncaught error: {error}", {
      error: err.message,
      stack: err.stack,
    });
    return errorResponse(
      { error: { type: "internal", message: "Internal Server Error" } },
      500,
    );
  });
}

export function createNotFoundHandler(app: Hono): void {
  app.notFound((_c) => {
    return errorResponse(
      { error: { type: "not_found", message: "Not Found" } },
      404,
    );
  });
}
