import type { DatabaseConnection } from "./db-connection.ts";
import { DbError } from "./db-connection.ts";
import { publish } from "./hub.ts";

export function requireDb(
  db: DatabaseConnection | undefined,
  context?: string,
): DatabaseConnection {
  if (!db) {
    const msg = context
      ? `Database is not connected (${context})`
      : "Database is not connected";
    throw new DbError(msg);
  }
  return db;
}

export async function withDb<T>(
  db: DatabaseConnection | undefined,
  fn: (db: DatabaseConnection) => Promise<T>,
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
