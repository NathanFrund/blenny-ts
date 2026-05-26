import { Surreal } from "@surrealdb/surrealdb";
import type { BlennyConfig } from "./config.ts";

export async function connectDatabase(
  config: BlennyConfig,
): Promise<Surreal | null> {
  try {
    const db = new Surreal();
    await db.connect(config.surrealUrl);
    await db.use({ namespace: config.surrealNs, database: config.surrealDb });
    await db.signin({
      username: config.surrealUser,
      password: config.surrealPass,
    });
    console.log("[db] connected to SurrealDB at " + config.surrealUrl);
    return db;
  } catch (err) {
    console.warn("[db] failed to connect to SurrealDB: " + err);
    return null;
  }
}
