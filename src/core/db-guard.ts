import type { Surreal } from "@surrealdb/surrealdb";

export class DbError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DbError";
  }
}

export function requireDb(db: Surreal | undefined): Surreal {
  if (!db) throw new DbError("Database is not connected");
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
    return fallback;
  }
}
