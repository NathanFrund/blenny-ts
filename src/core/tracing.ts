import {
  context,
  metrics,
  propagation,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type {
  Attributes,
  Histogram,
  Span,
  SpanOptions,
} from "@opentelemetry/api";

const tracer = trace.getTracer("blenny", "0.2.0");

export function withSpan<T>(
  name: string,
  fn: (span: Span) => T | Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  const span = tracer.startSpan(name, options);
  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const r = await fn(span);
      span.end();
      return r;
    } catch (err) {
      handleError(span, err);
      throw err;
    }
  });
}

function handleError(span: Span, err: unknown): void {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.end();
}

export function recordDuration(
  histogram: Histogram,
  startTime: number,
  attributes?: Attributes,
): void {
  histogram.record(performance.now() - startTime, attributes);
}

export { context, propagation, SpanStatusCode, trace };

export const meter = metrics.getMeter("blenny", "0.2.0");

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
