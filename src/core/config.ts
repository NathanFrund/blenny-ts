import { join } from "@std/path";

type ConfigSource = "cli" | "env" | "file" | "default";

const DEFAULTS: Record<string, string> = {
  "server.port": "3000",
  "server.bind_address": "0.0.0.0",
  "auth.jwt_secret": "CHANGE-ME-EMBEDDED-DEFAULT",
  "auth.session_duration_hours": "720",
  "auth.cookie_name": "blenny_session",
  "dev_mode": "true",
  "transport.auth_required": "true",
  "surreal.url": "ws://127.0.0.1:8000/rpc",
  "surreal.ns": "blenny",
  "surreal.db": "blenny",
  "surreal.user": "root",
  "surreal.pass": "root",
  "log.level": "",
  "log.format": "",
  "transport.max_connections": "10000",
  "transport.max_per_user": "100",
  "transport.idle_timeout_ms": "300000",
  "server.max_body_bytes": "1048576",
};

export interface ConfigOverrides {
  env?: Record<string, string | undefined>;
  args?: string[];
  fileContent?: string | null;
}

export class BlennyConfig {
  private data = new Map<string, string>();
  private sources = new Map<string, ConfigSource>();

  constructor(overrides?: ConfigOverrides) {
    this.applyDefaults();
    if (overrides) {
      this.applyFileOverride(overrides.fileContent);
      this.applyEnvOverride(overrides.env);
      this.applyCliOverride(overrides.args);
    } else {
      this.applyFile();
      this.applyEnv();
      this.applyCli();
    }
  }

  // ── Raw key lookup ──────────────────────────────────────────────

  at(key: string): string | undefined {
    return this.data.get(key);
  }

  // ── Convenience getters ─────────────────────────────────────────

  get port(): number {
    return Number(this.data.get("server.port"));
  }

  get bindAddress(): string {
    return this.data.get("server.bind_address")!;
  }

  get jwtSecret(): string {
    return this.data.get("auth.jwt_secret")!;
  }

  get sessionDurationHours(): number {
    return Number(this.data.get("auth.session_duration_hours"));
  }

  get cookieName(): string {
    return this.data.get("auth.cookie_name")!;
  }

  get devMode(): boolean {
    return this.data.get("dev_mode") === "true";
  }

  get transportAuthRequired(): boolean {
    const explicit = this.data.get("transport.auth_required");
    if (explicit === "true") return true;
    if (explicit === "false") return false;
    return !this.devMode;
  }

  get surrealUrl(): string {
    return this.data.get("surreal.url")!;
  }

  get surrealNs(): string {
    return this.data.get("surreal.ns")!;
  }

  get surrealDb(): string {
    return this.data.get("surreal.db")!;
  }

  get surrealUser(): string {
    return this.data.get("surreal.user")!;
  }

  get surrealPass(): string {
    return this.data.get("surreal.pass")!;
  }

  get logLevel(): string {
    return this.data.get("log.level") || (this.devMode ? "debug" : "info");
  }

  get logFormat(): string {
    return this.data.get("log.format") || (this.devMode ? "text" : "json");
  }

  get maxConnections(): number {
    return Number(this.data.get("transport.max_connections"));
  }

  get maxConnectionsPerUser(): number {
    return Number(this.data.get("transport.max_per_user"));
  }

  get idleTimeoutMs(): number {
    return Number(this.data.get("transport.idle_timeout_ms"));
  }

  get maxBodyBytes(): number {
    return Number(this.data.get("server.max_body_bytes"));
  }

  // ── Logging helper ───────────────────────────────────────────────

  logSources(): void {
    for (const [key, source] of this.sources) {
      if (source === "default") continue;
      const val = this.data.get(key) ?? "";
      const masked = key.endsWith("secret") || key.endsWith("pass")
        ? val.slice(0, 4) + "****"
        : val;
      console.log(`[config] ${key} = ${masked} (from ${source})`);
    }
  }

  // ── Composite providers ──────────────────────────────────────────

  private set(key: string, value: string, source: ConfigSource): void {
    const existing = this.sources.get(key);
    const priority: ConfigSource[] = ["default", "file", "env", "cli"];
    const existingPrio = priority.indexOf(existing ?? "default");
    const newPrio = priority.indexOf(source);
    if (newPrio >= existingPrio) {
      this.data.set(key, value);
      this.sources.set(key, source);
    }
  }

  private applyDefaults(): void {
    for (const [key, value] of Object.entries(DEFAULTS)) {
      this.data.set(key, value);
      this.sources.set(key, "default");
    }
  }

  private applyFile(): void {
    try {
      const cwd = Deno.cwd();
      const filePath = join(cwd, "blenny.json");
      const raw = Deno.readTextFileSync(filePath);
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          this.set(key, value, "file");
        } else if (typeof value === "number" || typeof value === "boolean") {
          this.set(key, String(value), "file");
        }
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        // File not found — silent skip
      } else if (err instanceof Deno.errors.PermissionDenied) {
        // No filesystem (Deno Deploy) — silent skip
      } else {
        console.warn(`[config] blenny.json parse error: ${err}`);
      }
    }
  }

  private applyEnv(): void {
    for (const key of Object.keys(DEFAULTS)) {
      const envName = "BLENNY_" + key.toUpperCase().replace(/\./g, "_");
      const value = Deno.env.get(envName);
      if (value !== undefined) {
        this.set(key, value, "env");
      }
    }
  }

  private applyCli(): void {
    const args = Deno.args;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("--")) continue;
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        if (key in DEFAULTS || key.includes(".")) {
          this.set(key, value, "cli");
        }
      } else {
        const key = arg.slice(2);
        if (key in DEFAULTS || key.includes(".")) {
          if (i + 1 < args.length && !args[i + 1].startsWith("--") && !args[i + 1].startsWith("-")) {
            this.set(key, args[++i], "cli");
          } else {
            this.set(key, "true", "cli");
          }
        }
      }
    }
  }

  // ── Test override providers ──────────────────────────────────────

  private applyFileOverride(fileContent: string | null | undefined): void {
    if (fileContent === undefined || fileContent === null) return;
    try {
      const parsed = JSON.parse(fileContent) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") {
          this.set(key, value, "file");
        } else if (typeof value === "number" || typeof value === "boolean") {
          this.set(key, String(value), "file");
        }
      }
    } catch {
      console.warn("[config] override file parse error");
    }
  }

  private applyEnvOverride(
    env: Record<string, string | undefined> | undefined,
  ): void {
    if (!env) return;
    for (const key of Object.keys(DEFAULTS)) {
      const envName = "BLENNY_" + key.toUpperCase().replace(/\./g, "_");
      const value = env[envName];
      if (value !== undefined) {
        this.set(key, value, "env");
      }
    }
  }

  private applyCliOverride(args: string[] | undefined): void {
    if (!args) return;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("--")) continue;
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        if (key in DEFAULTS || key.includes(".")) {
          this.set(key, value, "cli");
        }
      } else {
        const key = arg.slice(2);
        if (key in DEFAULTS || key.includes(".")) {
          if (
            i + 1 < args.length && !args[i + 1].startsWith("--") &&
            !args[i + 1].startsWith("-")
          ) {
            this.set(key, args[++i], "cli");
          } else {
            this.set(key, "true", "cli");
          }
        }
      }
    }
  }
}
