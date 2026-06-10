import { raw, Surreal, Table } from "@surrealdb/surrealdb";
import type {
  LiveMessage,
  LiveSubscription as SurrealLiveSubscription,
} from "@surrealdb/surrealdb";
import type { DatabaseConnection } from "./db-connection.ts";

export type { LiveMessage };
export type LiveSubscription = SurrealLiveSubscription;

export interface LiveQueryOptions {
  where?: string;
  fields?: string[];
  diff?: boolean;
}

export function liveQuery<T = unknown>(
  db: DatabaseConnection,
  table: string,
  options?: LiveQueryOptions,
): Promise<LiveSubscription> {
  const surreal = db.native<Surreal>();
  let q = surreal.live<T>(new Table(table));
  if (options?.where) q = q.where(raw(options.where));
  if (options?.fields?.length) q = q.fields(...options.fields);
  if (options?.diff) q = q.diff();
  return q;
}
