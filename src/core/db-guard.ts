import type { DbManager } from "./db-manager.ts";
import { publish } from "./hub.ts";

export class DbError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DbError";
  }
}

export function requireDb(
  db: DbManager | undefined,
  context?: string,
): DbManager {
  if (!db) {
    const msg = context
      ? `Database is not connected (${context})`
      : "Database is not connected";
    throw new DbError(msg);
  }
  return db;
}

export async function withDb<T>(
  db: DbManager | undefined,
  fn: (db: DbManager) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch (err) {
    if (err instanceof DbError) throw err;
    publish("log", {
      level: "warn",
      template: "Unexpected error in withDb: {error}",
      args: { error: String(err) },
    });
    return fallback;
  }
}
