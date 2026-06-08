export type Intent = "ui" | "data" | "command";

export type ServerMessage =
  | { intent: "ui"; html: string }
  | { intent: "data"; signals: Record<string, unknown> }
  | { intent: "command"; script: string };
