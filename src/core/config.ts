import { join } from "@std/path";

type ConfigSource = "cli" | "env" | "file" | "default";

const DEFAULTS: Record<string, string> = {
  "server.port": "3000",
  "server.bind_address": "0.0.0.0",
  "auth.jwt_secret": "CHANGE-ME-EMBEDDED-DEFAULT",
  "auth.session_duration_hours": "720",
  "auth.cookie_name": "blenny_session",
  "dev_mode": "true",
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
  "cors.origin": "",
  "ratelimit.window_ms": "60000",
  "ratelimit.max_requests": "30",
  "ratelimit.auth_window_ms": "300000",
  "ratelimit.auth_max_requests": "20",
  "server.trust_proxy": "false",
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
    return this.getNumeric("server.port", 1, 65535);
  }

  get bindAddress(): string {
    return this.data.get("server.bind_address")!;
  }

  get jwtSecret(): string {
    return this.data.get("auth.jwt_secret")!;
  }

  get sessionDurationHours(): number {
    return this.getNumeric("auth.session_duration_hours", 1, 876000);
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
    return this.getNumeric("transport.max_connections", 1, 1_000_000);
  }

  get maxConnectionsPerUser(): number {
    return this.getNumeric("transport.max_per_user", 1, 100_000);
  }

  get idleTimeoutMs(): number {
    return this.getNumeric("transport.idle_timeout_ms", 0, 86_400_000);
  }

  get maxBodyBytes(): number {
    return this.getNumeric("server.max_body_bytes", 1, 1_073_741_824);
  }

  get corsOrigin(): string {
    return this.data.get("cors.origin")!;
  }

  get ratelimitWindowMs(): number {
    return this.getNumeric("ratelimit.window_ms", 100, 3_600_000);
  }

  get ratelimitMaxRequests(): number {
    return this.getNumeric("ratelimit.max_requests", 1, 100_000);
  }

  get ratelimitAuthWindowMs(): number {
    return this.getNumeric("ratelimit.auth_window_ms", 100, 3_600_000);
  }

  get ratelimitAuthMaxRequests(): number {
    return this.getNumeric("ratelimit.auth_max_requests", 1, 100_000);
  }

  get trustProxy(): boolean {
    return this.data.get("server.trust_proxy") === "true";
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

  private getNumeric(key: string, min: number, max: number): number {
    const raw = this.data.get(key);
    const num = Number(raw);
    if (isNaN(num) || num < min || num > max) {
      throw new Error(
        `[config] ${key}: expected a number between ${min} and ${max}, got "${
          raw ?? ""
        }"`,
      );
    }
    return num;
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
    this.parseCliArgs(Deno.args, "cli");
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
    this.parseCliArgs(args, "cli");
  }

  private parseCliArgs(args: string[], source: ConfigSource): void {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("--")) continue;
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const key = arg.slice(2, eqIdx);
        const value = arg.slice(eqIdx + 1);
        if (key in DEFAULTS || key.includes(".")) {
          this.set(key, value, source);
        }
      } else {
        const key = arg.slice(2);
        if (key in DEFAULTS || key.includes(".")) {
          if (
            i + 1 < args.length && !args[i + 1].startsWith("--") &&
            !args[i + 1].startsWith("-")
          ) {
            this.set(key, args[++i], source);
          } else {
            this.set(key, "true", source);
          }
        }
      }
    }
  }
}
