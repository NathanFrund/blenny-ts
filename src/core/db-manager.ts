import { Surreal } from "@surrealdb/surrealdb";
import type { BlennyConfig } from "./config.ts";
import { publish } from "./hub.ts";

const HEALTH_INTERVAL_MS = 30_000;
const MAX_CONNECT_RETRIES = 3;

export class DbManager {
  private client: Surreal | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private _connected = false;
  private config: BlennyConfig;

  constructor(config: BlennyConfig) {
    this.config = config;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
      try {
        this.client?.close();
        this.client = new Surreal();
        await this.client.connect(this.config.surrealUrl, {
          authentication: {
            username: this.config.surrealUser,
            password: this.config.surrealPass,
          },
        });
        await this.client.query(
          `DEFINE NAMESPACE IF NOT EXISTS ${this.config.surrealNs}`,
        );
        await this.client.use({ namespace: this.config.surrealNs });
        await this.client.query(
          `DEFINE DATABASE IF NOT EXISTS ${this.config.surrealDb}`,
        );
        await this.client.use({
          namespace: this.config.surrealNs,
          database: this.config.surrealDb,
        });

        this._connected = true;
        publish("log", {
          level: "info",
          template: "Connected to SurrealDB at {url}",
          args: { url: this.config.surrealUrl },
        });

        this.startHealthCheck();
        return;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        this.client?.close();
        this.client = null;
        if (attempt < MAX_CONNECT_RETRIES) {
          const delay = Math.pow(2, attempt) * 1000;
          publish("log", {
            level: "warn",
            template:
              "SurrealDB connect attempt {attempt}/{maxRetries} failed, retrying in {delay}ms",
            args: {
              attempt,
              maxRetries: MAX_CONNECT_RETRIES,
              delay,
              error: lastErr.message,
            },
          });
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    this._connected = false;
    publish("log", {
      level: "warn",
      template:
        "Failed to connect to SurrealDB after {maxRetries} attempts: {error}",
      args: {
        maxRetries: MAX_CONNECT_RETRIES,
        error: lastErr?.message ?? "unknown",
      },
    });
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthTimer = setInterval(() => this.healthCheck(), HEALTH_INTERVAL_MS);
  }

  private stopHealthCheck(): void {
    if (this.healthTimer !== null) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async healthCheck(): Promise<void> {
    if (!this.client) {
      this._connected = false;
      await this.tryReconnect();
      return;
    }
    try {
      await this.client.query("RETURN 1");
      if (!this._connected) {
        this._connected = true;
        publish("log", {
          level: "info",
          template: "SurrealDB reconnected",
        });
      }
    } catch {
      this._connected = false;
      publish("log", {
        level: "warn",
        template: "SurrealDB health check failed, attempting reconnect…",
      });
      await this.tryReconnect();
    }
  }

  private async tryReconnect(): Promise<void> {
    this.stopHealthCheck();
    this.client?.close();
    this.client = null;
    await this.connect();
  }

  async query<T extends unknown[] = unknown[]>(
    query: string,
    vars?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.client || !this._connected) {
      throw new Error("Database not connected");
    }
    return await this.client.query<T>(query, vars) as unknown as T;
  }

  async close(): Promise<void> {
    this.stopHealthCheck();
    this.client?.close();
    this.client = null;
    this._connected = false;
  }
}
