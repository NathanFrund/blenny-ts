import type { BlennyConfig } from "./config.ts";

export class DbError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DbError";
  }
}

export interface DatabaseConnection {
  readonly connected: boolean;
  connect(): Promise<void>;
  close(): Promise<void>;
  query<T = unknown[]>(
    query: string,
    vars?: Record<string, unknown>,
  ): Promise<T>;
}

export type ConnectionFactory = (config: BlennyConfig) => DatabaseConnection;

const registry = new Map<string, ConnectionFactory>();

export function registerConnectionType(
  type: string,
  factory: ConnectionFactory,
): void {
  if (registry.has(type)) {
    throw new Error(`Connection type "${type}" is already registered`);
  }
  registry.set(type, factory);
}

export function createConnection(
  type: string,
  config: BlennyConfig,
): DatabaseConnection {
  const factory = registry.get(type);
  if (!factory) {
    const available = [...registry.keys()].join(", ");
    throw new Error(
      `Unknown database type "${type}". Available types: ${available || "(none)"}`,
    );
  }
  return factory(config);
}
