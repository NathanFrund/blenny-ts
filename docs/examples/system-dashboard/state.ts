import type { TransportHub } from "../../core/hub.ts";

export const state = {
  hub: undefined! as unknown as TransportHub,
  intervalHandle: undefined as ReturnType<typeof setInterval> | undefined,
  startedAt: 0,
};
