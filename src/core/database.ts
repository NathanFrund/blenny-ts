import { Surreal } from "@surrealdb/surrealdb";
import type { BlennyConfig } from "./config.ts";
import { publish } from "./hub.ts";

export async function connectDatabase(
  config: BlennyConfig,
): Promise<Surreal | null> {
  try {
    const db = new Surreal();
    await db.connect(config.surrealUrl, {
      authentication: {
        username: config.surrealUser,
        password: config.surrealPass,
      },
    });
    await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${config.surrealNs}`);
    await db.use({ namespace: config.surrealNs });
    await db.query(`DEFINE DATABASE IF NOT EXISTS ${config.surrealDb}`);
    await db.use({ namespace: config.surrealNs, database: config.surrealDb });
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
