export type Intent = "ui" | "data" | "command" | "notification" | "clock";

export interface ServerMessage {
  intent?: Intent;
  html?: string;
  signals?: Record<string, unknown>;
  script?: string;
}
