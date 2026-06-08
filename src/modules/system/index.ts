import type { AppState } from "../../core/app-state.ts";
import type { BlennyModule } from "../../types.ts";
import { publish } from "../../core/hub.ts";
import { state, type SystemMetrics } from "./state.ts";
import { handleDashboard } from "./handlers.tsx";

function collectMetrics(): SystemMetrics {
  const mem = Deno.systemMemoryInfo();
  return {
    memory: { total: mem.total, free: mem.free, used: mem.total - mem.free },
    loadAvg: Deno.loadavg?.() ?? [],
    hostname: Deno.hostname(),
    startTime: state.startedAt,
    collectedAt: new Date().toISOString(),
  };
}

const systemModule: BlennyModule = {
  name: "system",
  routes: [
    {
      method: "GET",
      path: "/system",
      auth: true,
      handler: handleDashboard,
    },
  ],
  initialize(state_: AppState) {
    state.conduit = state_.conduit;
  },
  start() {
    state.startedAt = Date.now();
    state.metrics = collectMetrics();
    state.intervalHandle = setInterval(() => {
      try {
        state.metrics = collectMetrics();
      } catch (err) {
        publish("log", {
          level: "error",
          template: "System metrics collection failed: {error}",
          args: { error: String(err) },
        });
      }
    }, 5_000);
  },
  stop() {
    if (state.intervalHandle) clearInterval(state.intervalHandle);
  },
};

export default systemModule;
