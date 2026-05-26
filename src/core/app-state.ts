import type { TransportHub } from "./hub.ts";
import type { Conduit } from "./conduit.ts";

export interface AppState {
  hub: TransportHub;
  conduit: Conduit;
}
