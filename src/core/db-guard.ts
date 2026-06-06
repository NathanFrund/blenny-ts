import type { Surreal } from "@surrealdb/surrealdb";
import { publish } from "./hub.ts";

export class DbError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DbError";
  }
}

export function requireDb(
  db: Surreal | undefined,
  context?: string,
): Surreal {
  if (!db) {
    const msg = context
      ? `Database is not connected (${context})`
      : "Database is not connected";
    throw new DbError(msg);
  }
  return db;
}

export async function withDb<T>(
  db: Surreal | undefined,
  fn: (db: Surreal) => Promise<T>,
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
