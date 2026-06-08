import type { Conduit } from "../../core/conduit.ts";

export interface SystemMetrics {
  memory: { total: number; free: number; used: number };
  loadAvg: number[];
  hostname: string;
  startTime: number;
  collectedAt: string;
}

export const state = {
  conduit: undefined! as unknown as Conduit,
  metrics: undefined as SystemMetrics | undefined,
  intervalHandle: undefined as ReturnType<typeof setInterval> | undefined,
  startedAt: 0,
};
