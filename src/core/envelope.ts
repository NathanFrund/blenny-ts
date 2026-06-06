export type Intent = "ui" | "data" | "command" | "notification" | "clock" | "task-demo";

export interface ServerMessage {
  intent?: Intent;
  html?: string;
  signals?: Record<string, unknown>;
  script?: string;
}
