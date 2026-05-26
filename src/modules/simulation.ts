import { publish } from "../core/hub.ts";
import type { BlennyModule } from "../types.ts";

let cycle = 0;
let timer: ReturnType<typeof setInterval> | undefined;

const module: BlennyModule = {
  name: "simulation",
  routes: [
    {
      method: "GET",
      path: "/simulation/status",
      handler: (c) => c.json({ running: timer !== undefined, currentCycle: cycle }),
    },
  ],
  start() {
    timer = setInterval(() => {
      cycle++;
      publish("spatial:tick", { cycle, activeAgents: 12 });
    }, 1000);
    console.log("[simulation] tick started");
  },
  stop() {
    clearInterval(timer);
    timer = undefined;
    console.log("[simulation] tick stopped");
  },
};

export default module;
