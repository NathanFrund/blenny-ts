import type { Surreal } from "@surrealdb/surrealdb";
import type { BlennyLogger } from "./logger.ts";

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
  logger?: BlennyLogger,
): Promise<T> {
  if (!db) return fallback;
  try {
    return await fn(db);
  } catch (err) {
    if (err instanceof DbError) throw err;
    if (logger) {
      logger.warn("Unexpected error in withDb: {error}", {
        error: String(err),
      });
    }
    return fallback;
  }
}
