import { Surreal } from "@surrealdb/surrealdb";
import type { BlennyConfig } from "./config.ts";
import type { BlennyLogger } from "./logger.ts";

export async function connectDatabase(
  config: BlennyConfig,
  logger?: BlennyLogger,
): Promise<Surreal | null> {
  try {
    const db = new Surreal();
    await db.connect(config.surrealUrl);
    await db.use({ namespace: config.surrealNs, database: config.surrealDb });
    await db.signin({
      username: config.surrealUser,
      password: config.surrealPass,
    });
    if (logger) {
      logger.info("Connected to SurrealDB at {url}", {
        url: config.surrealUrl,
      });
    } else {
      console.log("[db] connected to SurrealDB at " + config.surrealUrl);
    }
    return db;
  } catch (err) {
    if (logger) {
      logger.warn("Failed to connect to SurrealDB: {error}", {
        error: String(err),
      });
    } else {
      console.warn("[db] failed to connect to SurrealDB:", String(err));
    }
    return null;
  }
}
