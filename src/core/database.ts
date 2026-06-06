import { Surreal } from "@surrealdb/surrealdb";
import type { BlennyConfig } from "./config.ts";
import { publish } from "./hub.ts";

export async function connectDatabase(
  config: BlennyConfig,
): Promise<Surreal | null> {
  try {
    const db = new Surreal();
    await db.connect(config.surrealUrl, {
      namespace: config.surrealNs,
      database: config.surrealDb,
      authentication: {
        username: config.surrealUser,
        password: config.surrealPass,
      },
    });
    publish("log", {
      level: "info",
      template: "Connected to SurrealDB at {url}",
      args: { url: config.surrealUrl },
    });
    return db;
  } catch (err) {
    publish("log", {
      level: "warn",
      template: "Failed to connect to SurrealDB: {error}",
      args: { error: String(err) },
    });
    return null;
  }
}
