import { trace, metrics, context, propagation, SpanStatusCode } from "@opentelemetry/api";
import type { Span } from "@opentelemetry/api";

const tracer = trace.getTracer("blenny", "0.1.0");

export function withSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
): Promise<T> {
  const span = tracer.startSpan(name);
  try {
    const result = context.with(trace.setSpan(context.active(), span), () => {
      try {
        const r = fn(span);
        if (r instanceof Promise) {
          return r
            .then((val) => {
              span.end();
              return val;
            })
            .catch((err) => {
              handleError(span, err);
              throw err;
            });
        }
        span.end();
        return Promise.resolve(r);
      } catch (err) {
        handleError(span, err);
        throw err;
      }
    });
    return result as Promise<T>;
  } catch (err) {
    return Promise.reject(err);
  }
}

function handleError(span: Span, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.end();
}

export { trace, context, propagation, SpanStatusCode };

export const meter = metrics.getMeter("blenny", "0.1.0");

export const activeConnections = meter.createUpDownCounter(
  "blenny.hub.connections",
  { description: "Active hub connections" },
);

export const messagesSent = meter.createCounter(
  "blenny.hub.messages.sent",
  { description: "Messages sent via hub" },
);

export const messageDuration = meter.createHistogram(
  "blenny.hub.message.duration",
  { description: "Duration of individual message sends", unit: "ms" },
);
