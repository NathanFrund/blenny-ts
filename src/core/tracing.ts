import { trace, metrics } from "@opentelemetry/api";

export const tracer = trace.getTracer("blenny", "0.1.0");
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
