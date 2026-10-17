import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteUserStore } from "./sqlite-user-store.ts";
import type { BlobStore } from "./store.ts";

export interface SqliteStores {
  db: Database;
  store: SqliteUserStore;
  blobStore: BlobStore;
}

export function openSqliteStore(dbPath: string, blobStore: BlobStore): SqliteStores {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  return { db, blobStore, store: new SqliteUserStore(db, blobStore) };
}
