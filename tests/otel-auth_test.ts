import { assertEquals } from "@std/assert";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { trace } from "@opentelemetry/api";
import { createToken, getUser } from "@blenny/core/auth.ts";
import type { AuthConfig } from "@blenny/core/auth.ts";
import { Context } from "@hono/hono";

const config: AuthConfig = {
  jwtSecret: "test-secret",
  cookieName: "test_session",
  sessionExpiry: 3600,
};

const adminUser = { id: "admin", role: "admin" };

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
trace.setGlobalTracerProvider(provider);

Deno.test("OTel auth instrumentation", async (t) => {
  await t.step("createToken creates an auth.createToken span", async () => {
    exporter.reset();
    await createToken(adminUser, config);

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1);
    assertEquals(spans[0].name, "auth.createToken");
  });

  await t.step("getUser creates an auth.getUser span", async () => {
    exporter.reset();
    const token = await createToken(adminUser, config);
    const req = new Request("http://localhost/", {
      headers: { Cookie: `test_session=${token}` },
    });
    const c = new Context(req);

    await getUser(c, config);

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 2);
    const names = spans.map((s) => s.name);
    assertEquals(names.includes("auth.createToken"), true);
    assertEquals(names.includes("auth.getUser"), true);
  });
});
