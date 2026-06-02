import type { MiddlewareHandler } from "@hono/hono";
import { trace } from "../tracing.ts";

export interface RouteInfo {
  path: string;
  method: string;
}

export function withRouteSpan(
  route: RouteInfo,
  handler: MiddlewareHandler,
): MiddlewareHandler {
  return (c, next) => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute("http.route", route.path);
      span.updateName(`${route.method.toUpperCase()} ${route.path}`);
    }
    return handler(c, next);
  };
}
