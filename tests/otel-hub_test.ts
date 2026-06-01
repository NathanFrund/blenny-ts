import { assertEquals } from "@std/assert";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode, trace } from "@opentelemetry/api";
import { TransportHub } from "../src/core/hub.ts";
import type { Connection, ConnId } from "../src/core/hub.ts";
import type { Intent, ServerMessage } from "../src/core/envelope.ts";

class CaptureOtelConnection implements Connection {
  id: ConnId;
  userId?: string;
  intents?: Set<Intent>;
  connType = "capture";
  lastWriteAt: number;

  constructor(
    id: string,
    opts?: { userId?: string; intents?: Set<Intent> },
  ) {
    this.id = id;
    this.userId = opts?.userId;
    this.intents = opts?.intents;
    this.lastWriteAt = Date.now();
  }

  send(_msg: ServerMessage): void {}
  close(): void {}
}

class ThrowingOtelConnection implements Connection {
  id: ConnId;
  connType = "throwing";
  lastWriteAt: number;

  constructor(id: string) {
    this.id = id;
    this.lastWriteAt = Date.now();
  }

  send(_msg: ServerMessage): void {
    throw new Error("simulated send failure");
  }
  close(): void {}
}

const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
trace.setGlobalTracerProvider(provider);

Deno.test("OTel hub instrumentation", async (t) => {
  await t.step("broadcastToAll creates a hub.broadcast span", async () => {
    exporter.reset();
    const hub = new TransportHub();
    const conn = new CaptureOtelConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    await hub.mergeSignals({ test: true });

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1);
    assertEquals(spans[0].name, "hub.broadcast");
    assertEquals(spans[0].attributes?.["conn.count"], 1);
    assertEquals(spans[0].attributes?.["msg.intent"], "none");
  });

  await t.step("directToUser creates a hub.direct span", async () => {
    exporter.reset();
    const hub = new TransportHub();
    const conn = new CaptureOtelConnection(
      crypto.randomUUID(),
      { userId: "alice" },
    );
    hub.registerConnection(conn);

    await hub.mergeSignals({ test: true }, { userId: "alice" });

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1);
    assertEquals(spans[0].name, "hub.direct");
    assertEquals(spans[0].attributes?.["user.id"], "alice");
  });

  await t.step("empty hub skips span creation", async () => {
    exporter.reset();
    const hub = new TransportHub();

    await hub.mergeSignals({ test: true });

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 0);
  });

  await t.step("non-existent user skips span creation", async () => {
    exporter.reset();
    const hub = new TransportHub();

    await hub.mergeSignals({ test: true }, { userId: "ghost" });

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 0);
  });

  await t.step("failed send sets ERROR status on broadcast span", async () => {
    exporter.reset();
    const hub = new TransportHub();
    const conn = new ThrowingOtelConnection(crypto.randomUUID());
    hub.registerConnection(conn);

    await hub.mergeSignals({ test: true });

    const spans = exporter.getFinishedSpans();
    assertEquals(spans.length, 1);
    assertEquals(spans[0].name, "hub.broadcast");
    assertEquals(
      spans[0].status.code,
      SpanStatusCode.ERROR,
    );
    assertEquals(spans[0].attributes?.["write.errors"], 1);
  });

  await t.step(
    "unmatched intent still creates span with conn.count and no errors",
    async () => {
      exporter.reset();
      const hub = new TransportHub();
      const conn = new CaptureOtelConnection(
        crypto.randomUUID(),
        { intents: new Set<Intent>(["ui"]) },
      );
      hub.registerConnection(conn);

      await hub.mergeSignals({ test: true }, { intent: "data" });

      const spans = exporter.getFinishedSpans();
      assertEquals(spans.length, 1);
      assertEquals(spans[0].name, "hub.broadcast");
      assertEquals(spans[0].attributes?.["conn.count"], 1);
      assertEquals(spans[0].attributes?.["msg.intent"], "data");
      assertEquals(spans[0].attributes?.["write.errors"], undefined);
    },
  );

  await t.step(
    "intent broadcast adds msg.intent attribute on span",
    async () => {
      exporter.reset();
      const hub = new TransportHub();
      const conn = new CaptureOtelConnection(
        crypto.randomUUID(),
        { intents: new Set<Intent>(["ui"]) },
      );
      hub.registerConnection(conn);

      await hub.mergeSignals({ test: true }, { intent: "ui" });

      const spans = exporter.getFinishedSpans();
      assertEquals(spans.length, 1);
      assertEquals(spans[0].name, "hub.broadcast");
      assertEquals(spans[0].attributes?.["msg.intent"], "ui");
    },
  );
});
