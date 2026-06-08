import type { BlennyConfig } from "./config.ts";
import type { DatabaseConnection } from "./db-connection.ts";
import { createConnection } from "./db-connection.ts";
// Side-effect import — registers the "surreal" connection driver
import "./db-manager.ts";

export async function connectDatabase(
  config: BlennyConfig,
): Promise<DatabaseConnection | null> {
  const type = config.at("database.type") ?? "surreal";
  try {
    const manager = createConnection(type, config);
    await manager.connect();
    return manager;
  } catch (err) {
    console.error(`[database] Failed to connect to "${type}":`, err);
    return null;
  }
}
