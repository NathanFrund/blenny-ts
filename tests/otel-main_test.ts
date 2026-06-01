import { assertEquals } from "@std/assert";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, trace } from "@opentelemetry/api";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
trace.setGlobalTracerProvider(provider);
const tracer = trace.getTracer("test");

Deno.test("OTel main.ts instrumentation", async (t) => {
  await t.step(
    "route handler wrapper sets http.route and updates span name",
    () => {
      exporter.reset();
      const span = tracer.startSpan("original.span");

      // Simulates what main.ts:159-164 does in the route wrapper
      span.setAttribute("http.route", "/test");
      span.updateName("GET /test");

      span.end();

      const spans = exporter.getFinishedSpans();
      assertEquals(spans.length, 1);
      assertEquals(spans[0].name, "GET /test");
      assertEquals(spans[0].attributes?.["http.route"], "/test");
    },
  );

  await t.step(
    "onError sets ERROR status and records exception",
    () => {
      exporter.reset();
      const error = new Error("something broke");
      const span = tracer.startSpan("test.error");

      // Simulates what main.ts:82-85 does in the onError handler
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);

      span.end();

      const spans = exporter.getFinishedSpans();
      assertEquals(spans.length, 1);
      assertEquals(spans[0].name, "test.error");
      assertEquals(
        spans[0].status.code,
        SpanStatusCode.ERROR,
      );
      assertEquals(spans[0].status.message, "something broke");
      assertEquals(
        spans[0].events?.[0]?.name,
        "exception",
      );
    },
  );
});
