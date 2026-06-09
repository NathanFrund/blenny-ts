import type { AppState } from "../../core/app-state.ts";
import type { BlennyModule } from "../../types.ts";
import { publish } from "../../core/hub.ts";
import { state } from "./state.ts";
import { handleDashboard } from "./handlers.tsx";

function bytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
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
    state.hub = state_.hub;
  },
  start() {
    state.startedAt = Date.now();
    const push = () => {
      try {
        const mem = Deno.systemMemoryInfo();
        const loadAvg = Deno.loadavg?.() ?? [];
        state.hub.mergeSignals({
          sys: {
            hostname: Deno.hostname(),
            memTotal: bytes(mem.total),
            memUsed: bytes(mem.total - mem.free),
            memFree: bytes(mem.free),
            load1m: (loadAvg[0] ?? 0).toFixed(2),
            load5m: (loadAvg[1] ?? 0).toFixed(2),
            load15m: (loadAvg[2] ?? 0).toFixed(2),
            uptime: ((Date.now() - state.startedAt) / 3600000).toFixed(1),
            collectedAt: new Date().toLocaleTimeString(),
          },
        });
      } catch (err) {
        publish("log", {
          level: "error",
          template: "System metrics push failed: {error}",
          args: { error: String(err) },
        });
      }
    };
    push();
    state.intervalHandle = setInterval(push, 5_000);
  },
  stop() {
    if (state.intervalHandle) clearInterval(state.intervalHandle);
  },
};

export default systemModule;
