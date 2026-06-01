import { assertEquals } from "@std/assert";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { deriveKey } from "../src/modules/form-auth/crypto.ts";

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
trace.setGlobalTracerProvider(provider);

Deno.test("OTel crypto instrumentation", async (t) => {
  await t.step("deriveKey creates an auth.deriveKey span", async () => {
    exporter.reset();
    await deriveKey("test-password", "test-salt");

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1);
    assertEquals(spans[0].name, "auth.deriveKey");
    assertEquals(spans[0].status.code, SpanStatusCode.UNSET);
  });
});
