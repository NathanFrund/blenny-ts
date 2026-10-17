// OpenTelemetry integration is intentionally deferred for the Bun port.
//
// This module preserves the instrumentation seams used across the codebase
// (withSpan, trace.getActiveSpan, SpanStatusCode, and the hub meter counters)
// as no-ops, so call sites remain unchanged and a real provider can be dropped
// in later without touching consumers. The original Deno/OTel implementation is
// preserved at docs/telemetry.deno.ts.bak, and docs/telemetry.md documents the
// full Deno-era spec (what was instrumented and why).
//
// Set BLENNY_TELEMETRY_STRICT=1 to turn this into a fail-fast "loud" stub: every
// instrumentation call throws instead of silently discarding data. Run it in dev
// or a dedicated test to build a precise inventory of call sites that WOULD be
// instrumented, before committing to a real OTel/Bun backend. It is not meant for
// a running server (the first request or hub message will throw).

const STRICT = (Bun.env.BLENNY_TELEMETRY_STRICT ?? "") === "1";

export class TelemetryNotConfiguredError extends Error {
  constructor(operation: string) {
    super(
      `Telemetry operation "${operation}" fired but no backend is configured. ` +
        `OTel is deferred for Bun. Set BLENNY_TELEMETRY_STRICT=0 to silence this stub.`,
    );
    this.name = "TelemetryNotConfiguredError";
  }
}

export const SpanStatusCode = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

export type SpanStatusCodeValue = (typeof SpanStatusCode)[keyof typeof SpanStatusCode];

export interface SpanStatus {
  code: SpanStatusCodeValue;
  message?: string;
}

export interface Attributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  setAttribute(key: string, value: unknown): void;
  setStatus(status: SpanStatus): void;
  recordException(exception: unknown): void;
  updateName(name: string): void;
  end(): void;
}

export interface SpanOptions {
  [key: string]: unknown;
}

function noopSpan(): Span {
  return {
    setAttribute() {},
    setStatus() {},
    recordException() {},
    updateName() {},
    end() {},
  };
}

export function withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, _options?: SpanOptions): Promise<T> {
  if (STRICT) throw new TelemetryNotConfiguredError(`withSpan("${name}")`);
  const span = noopSpan();
  // NOTE: fn must be invoked synchronously. The real OTel implementation used
  // context.with(ctx, async cb), which runs cb() synchronously up to its first
  // await. Hub delivery (hub.write -> conn.send) relies on that synchronous
  // prefix landing messages before callers observe the result. See hub.ts.
  return (async () => {
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.end();
      throw err;
    }
  })();
}

export interface Counter {
  add(value: number, attributes?: Attributes): void;
}

export interface UpDownCounter {
  add(value: number, attributes?: Attributes): void;
}

export interface Histogram {
  record(value: number, attributes?: Attributes): void;
}

export function recordDuration(_histogram: Histogram, _startTime: number, _attributes?: Attributes): void {
  if (STRICT) throw new TelemetryNotConfiguredError("recordDuration()");
}

function metricThrow(operation: string): void {
  if (STRICT) throw new TelemetryNotConfiguredError(operation);
}

const noopUpDownCounter: UpDownCounter = {
  add(_value, _attributes) {
    metricThrow("activeConnections.add()");
  },
};
const noopCounter: Counter = {
  add(_value, _attributes) {
    metricThrow("messagesSent.add()");
  },
};
const noopHistogram: Histogram = {
  record(_value, _attributes) {
    metricThrow("messageDuration.record()");
  },
};

export const activeConnections: UpDownCounter = noopUpDownCounter;
export const messagesSent: Counter = noopCounter;
export const messageDuration: Histogram = noopHistogram;

// Instrument construction is setup, not recorded data, so it stays silent even
// in strict mode.
export const meter = {
  createCounter: (_name: string, _options?: unknown): Counter => noopCounter,
  createUpDownCounter: (_name: string, _options?: unknown): UpDownCounter => noopUpDownCounter,
  createHistogram: (_name: string, _options?: unknown): Histogram => noopHistogram,
};

export const trace = {
  getActiveSpan(): Span | undefined {
    if (STRICT) throw new TelemetryNotConfiguredError("trace.getActiveSpan()");
    return undefined;
  },
};

export const context = {
  active(): unknown {
    return {};
  },
  with<T>(_ctx: unknown, fn: () => T): T {
    return fn();
  },
};

export const propagation = {};
