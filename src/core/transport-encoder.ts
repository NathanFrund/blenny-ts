import type { ServerMessage } from "./envelope.ts";

export interface TransportEncoder {
  readonly name: string;
  readonly contentType: string;
  encode(msg: ServerMessage): string;
}
