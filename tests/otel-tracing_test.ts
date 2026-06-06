import { assertEquals } from "@std/assert";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { withSpan } from "../src/core/tracing.ts";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
trace.setGlobalTracerProvider(provider);

Deno.test("OTel withSpan wrapper", async (t) => {
  await t.step("sync callback produces a finished span", async () => {
    exporter.reset();
    await withSpan("test.sync", (_span) => {
      return 42;
    });

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1);
    assertEquals(spans[0].name, "test.sync");
  });

  await t.step("async callback produces a finished span", async () => {
    exporter.reset();
    await withSpan("test.async", async (_span) => {
      await Promise.resolve();
      return "ok";
    });

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1);
    assertEquals(spans[0].name, "test.async");
  });

  await t.step(
    "thrown exception sets ERROR status and recordException",
    async () => {
      exporter.reset();
      const error = new Error("boom");

      await withSpan("test.error", (_span) => {
        throw error;
      }).catch(() => {});

      const spans = exporter.getFinishedSpans();
      assertEquals(spans.length, 1);
      assertEquals(spans[0].name, "test.error");
      assertEquals(spans[0].status.code, SpanStatusCode.ERROR);
      assertEquals(spans[0].status.message, "boom");
      assertEquals(spans[0].events?.[0]?.name, "exception");
    },
  );

  await t.step("sync callback propagates return value", () => {
    exporter.reset();
    const result = withSpan("test.return", (_span) => {
      return "hello";
    });

    // withSpan always returns a Promise
    return result.then((val) => {
      assertEquals(val, "hello");
      const spans = exporter.getFinishedSpans();
      assertEquals(spans.length, 1);
    });
  });
});
