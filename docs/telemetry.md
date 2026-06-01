# OpenTelemetry Instrumentation

## Overview

Blenny uses Deno's [built-in OpenTelemetry integration](
  https://docs.deno.com/runtime/fundamentals/open_telemetry/
).
All instrumented paths import only from `@opentelemetry/api` — no SDK packages
in source. When telemetry is disabled (the default), the API is a no-op with
negligible overhead.

Enable telemetry by setting `OTEL_DENO=true` (a Deno-native env var, not a
Blenny custom). Deno's runtime automatically configures the SDK, registers the
global tracer provider, and reads standard OTLP environment variables. No
manual `trace.setGlobalTracerProvider()` call is needed.

## Enabling Telemetry

```bash
# Run with telemetry exported to an OTLP collector
OTEL_DENO=true OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
  deno run --allow-env --allow-net main.ts

# Debug instrumentation locally — prints spans/metrics to stderr
OTEL_DENO=true OTEL_EXPORTER_OTLP_PROTOCOL=console \
  deno run --allow-env --allow-net main.ts
```

Console output example:

```
SPAN hub.broadcast [00000000000000000000000000000001/0000000000000002] Internal 0.495ms
  scope: blenny@0.1.0
  conn.count: 1
  msg.intent: none
```

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_DENO` | unset | Must be `true` to activate Deno's OTel integration |
| `OTEL_SERVICE_NAME` | `<unknown_service>` | Resource service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | One of `http/protobuf`, `http/json`, `grpc`, or `console` |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Auth headers for the collector |
| `OTEL_RESOURCE_ATTRIBUTES` | — | Additional resource attributes (e.g. `environment=production`) |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | Metric export interval in ms |

See the [Deno OTel configuration docs](
  https://docs.deno.com/runtime/fundamentals/open_telemetry/#configuration
) for the full list.

### Auto-instrumentation

When `OTEL_DENO=true` is set, Deno automatically instruments:

- **`Deno.serve`** — a span is created for each incoming request with
  `http.request.method`, `url.path`, and `http.response.status_code`
  attributes. The span ends when response headers are sent.
- **`fetch`** — a client span is created for each outgoing HTTP request.
- **`console.*`** — log records are exported alongside trace context.

Blenny's route handler wrappers in `main.ts` extend Deno's server spans by
setting `http.route` and calling `updateName()` (e.g. `GET /auth/signin`),
following Deno's [recommended pattern](
  https://docs.deno.com/runtime/fundamentals/open_telemetry/#deno.serve
).

Deno does NOT set error status on server spans when a handler throws. Blenny's
`onError` handler fills this gap — it calls `span.setStatus(ERROR)` and
`span.recordException(err)` on the active span.

## Traced Operations

### Hub — `src/core/hub.ts`

| Span name | When | Attributes |
|---|---|---|
| `hub.broadcast` | Message sent to all connections | `conn.count`, `msg.intent`, `write.errors` (on failure) |
| `hub.direct` | Message sent to a specific user's connections | `user.id`, `conn.count`, `write.errors` (on failure) |

Failed writes (sync throws and async rejections) set `SpanStatusCode.ERROR` and
record a `write.errors` count attribute. The hub continues delivering to the
remaining connections after a failure.

### Auth — `src/core/auth.ts`

| Span name | When | Attributes |
|---|---|---|
| `auth.createToken` | JWT signed for a user session | — |
| `auth.getUser` | JWT verified and decoded from cookie or query param | — |

### Crypto — `src/modules/form-auth/crypto.ts`

| Span name | When | Attributes |
|---|---|---|
| `auth.deriveKey` | PBKDF2 key derivation during registration / sign-in | — |

### HTTP — `main.ts`

Deno automatically creates a server span for each `Deno.serve` request. Blenny's
route middleware (applied at registration time) augments that span:

- Sets `http.route` to the matched path (e.g. `/auth/signin`)
- Calls `span.updateName()` to include the HTTP method (e.g. `GET /auth/signin`)

The `onError` handler sets `SpanStatusCode.ERROR` and calls
`recordException()` on the active span when a request handler throws — filling
a gap in Deno's auto-instrumentation that does not record errors on server
spans.

## Metrics

All metrics are created from a shared meter named `blenny` version `0.1.0`.

| Metric | Type | Attributes | When recorded |
|---|---|---|---|
| `blenny.hub.connections` | `UpDownCounter` | `conn.type` | Connection registered / removed |
| `blenny.hub.messages.sent` | `Counter` | `conn.type`, `msg.intent` | Each successful send |
| `blenny.hub.message.duration` | `Histogram` | `conn.type` | Each send (ms) |

## Adding New Instrumentation

Use the `withSpan` wrapper exported from `src/core/tracing.ts`:

```ts
import { withSpan } from "../core/tracing.ts";

export async function myOperation(arg: string): Promise<number> {
  return withSpan("my.module.op", async (span) => {
    span.setAttribute("arg.length", arg.length);
    // ... logic ...
    return result;
  });
}
```

The wrapper handles span lifecycle (creation via `tracer.startSpan`,
activation via `context.with(trace.setSpan(...))`, and cleanup via
`span.end()`). Exceptions are automatically recorded and the span status is set
to `ERROR`.

For low-level metric recording, use the `recordDuration` helper:

```ts
import { recordDuration, messageDuration } from "../core/tracing.ts";

const start = performance.now();
// ... work ...
recordDuration(messageDuration, start, { "result.type": "success" });
```

## Code Architecture

```ts
// src/core/tracing.ts
//   - Creates tracer + meter via @opentelemetry/api
//   - Exports withSpan(), recordDuration(), metric instruments
//   - Re-exports trace, context, propagation, SpanStatusCode
//   - Does NOT create a TracerProvider — Deno's runtime provides it

// src/core/hub.ts          — uses withSpan for broadcast/direct spans
// src/core/auth.ts         — uses withSpan for createToken/getUser
// src/modules/form-auth/crypto.ts — uses withSpan for deriveKey
// main.ts                  — augments Deno.serve spans, fills error gap
```

## Test Coverage

Four test files verify the instrumentation using `InMemorySpanExporter` from
`@opentelemetry/sdk-trace-base`. Each file creates its own
`BasicTracerProvider` + `SimpleSpanProcessor` — this is the standard testing
pattern and does not conflict with Deno's runtime OTel (tests run without
`OTEL_DENO=true`).

| File | Steps | What it covers |
|---|---|---|
| `tests/otel-hub_test.ts` | 7 | Broadcast/direct spans, attributes, error status, empty hub skip, unmatched intent |
| `tests/otel-auth_test.ts` | 2 | createToken and getUser span names; uses name-list matching (not index order) |
| `tests/otel-crypto_test.ts` | 1 | deriveKey span name and UNSET status |
| `tests/otel-tracing_test.ts` | 4 | withSpan sync/async callbacks, exception recording, return value propagation |
| `tests/otel-main_test.ts` | 2 | Route wrapper attribute setting, onError exception recording |

Run them with:

```bash
deno test --allow-env tests/otel-*
```

The `@opentelemetry/sdk-trace-base` package is listed in `deno.json` imports
but is only loaded by the test runner — it is never included in production
builds.
