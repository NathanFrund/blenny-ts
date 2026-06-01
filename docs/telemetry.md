# OpenTelemetry Instrumentation

## Overview

Blenny ships with OpenTelemetry instrumentation for tracing and metrics built
into the core. All instrumented paths use the no-op API from
`@opentelemetry/api` — zero overhead and zero dependencies at runtime unless
you explicitly enable telemetry.

Enable telemetry by setting `OTEL_DENO=true` and configuring an OTLP exporter.
The SDK packages (`@opentelemetry/sdk-trace-base`, etc.) are only loaded when
telemetry is active.

## Enabling Telemetry

```bash
export OTEL_DENO=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
deno run --allow-env --allow-net main.ts
```

The SDK picks up standard OTel environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `OTEL_DENO` | unset | Must be `true` to activate the SDK |
| `OTEL_SERVICE_NAME` | `blenny` | Resource service name |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP endpoint |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | Auth headers for the collector |

When `OTEL_DENO` is not set (the default), all `tracer.startActiveSpan()` and
`meter.createX()` calls are no-ops. The `@opentelemetry/api` package is always
imported but the SDK packages are never loaded.

## Traced Operations

### Hub — `src/core/hub.ts`

| Span name | When | Attributes |
|---|---|---|
| `hub.broadcast` | Message sent to all connections | `conn.count`, `msg.intent`, `write.errors` (on failure) |
| `hub.directToUser` | Message sent to a specific user's connections | `user.id`, `conn.count`, `write.errors` (on failure) |

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

Route handler wrappers set `http.route` and call `updateName()` on the active
span (e.g. `GET /auth/signin`). The `onError` handler sets
`SpanStatusCode.ERROR` and calls `recordException()` on the active span when a
request handler throws.

## Metrics

All metrics are created from a shared meter named `blenny` version `0.1.0`.

| Metric | Type | Attributes | When incremented |
|---|---|---|---|
| `blenny.hub.connections` | `UpDownCounter` | `conn.type` | Connection registered / removed |
| `blenny.hub.messages.sent` | `Counter` | `conn.type`, `msg.intent` | Each successful send |
| `blenny.hub.message.duration` | `Histogram` | `conn.type` | Each send (ms) |

## Shared Tracer

All spans share a single tracer created in `src/core/tracing.ts`:

```ts
export const tracer = trace.getTracer("blenny", "0.1.0");
export const meter = metrics.getMeter("blenny", "0.1.0");
```

Add new instrumentations by importing `tracer` from `src/core/tracing.ts`
and wrapping the operation in `tracer.startActiveSpan()`.

## Test Coverage

Four test files verify the instrumentation using `InMemorySpanExporter` from
`@opentelemetry/sdk-trace-base`:

| File | Steps | What it covers |
|---|---|---|
| `tests/otel-hub_test.ts` | 7 | Broadcast/direct spans, attributes, error status, empty hub skip, unmatched intent |
| `tests/otel-auth_test.ts` | 2 | createToken and getUser span names |
| `tests/otel-crypto_test.ts` | 1 | deriveKey span name and UNSET status |
| `tests/otel-main_test.ts` | 2 | Route wrapper attribute setting, onError exception recording |

Run them with:

```bash
deno test --allow-env tests/otel-*
```

The SDK test packages are listed in `deno.json` imports but only loaded by the
test runner — they are never bundled into production builds.
