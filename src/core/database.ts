import type { BlennyConfig } from "./config.ts";
import type { DatabaseConnection } from "./db-connection.ts";
import { DbError } from "./db-connection.ts";
import { publish } from "./hub.ts";

const DRIVERS: Record<
  string,
  (config: BlennyConfig) => Promise<DatabaseConnection>
> = {
  surreal: async (cfg) => {
    const { SurrealConnectionManager } = await import("./db-manager.ts");
    const mgr = new SurrealConnectionManager(cfg);
    await mgr.connect();
    return mgr;
  },
};

export async function connectDatabase(
  config: BlennyConfig,
): Promise<DatabaseConnection | null> {
  const type = config.at("database.type") ?? "surreal";
  const instantiate = DRIVERS[type];

  if (!instantiate) {
    throw new DbError(
      `Unknown database type "${type}". Supported types: ${
        Object.keys(DRIVERS).join(", ")
      }`,
    );
  }

  try {
    return await instantiate(config);
  } catch (err) {
    publish("log", {
      level: "error",
      template: `[database] Failed to connect to "{type}": {error}`,
      args: { type, error: String(err) },
    });
    return null;
  }
}
