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
  native<T>(): T;
}
