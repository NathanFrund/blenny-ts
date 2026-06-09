import { Surreal, Table, raw } from "@surrealdb/surrealdb";
import type { LiveSubscription as SurrealLiveSubscription, LiveMessage } from "@surrealdb/surrealdb";
import type { DatabaseConnection } from "./db-connection.ts";

export type { LiveMessage };
export type LiveSubscription = SurrealLiveSubscription;

export interface LiveQueryOptions {
  where?: string;
  fields?: string[];
  diff?: boolean;
}

export async function liveQuery<T = unknown>(
  db: DatabaseConnection,
  table: string,
  options?: LiveQueryOptions,
): Promise<LiveSubscription> {
  const surreal = db.native<Surreal>();
  let query = surreal.live<T>(new Table(table));
  if (options?.where) query = query.where(raw(options.where));
  if (options?.fields?.length) query = query.fields(...options.fields);
  if (options?.diff) query = query.diff();
  return query;
}
