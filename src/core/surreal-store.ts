import * as v from "@valibot/valibot";
import type { DatabaseConnection } from "./db-connection.ts";
import { NewUserSchema } from "./validation.ts";
import type { NewUserInput } from "./validation.ts";
import type { StoredUser, UserStore } from "./store.ts";
import { unwrapFirst } from "./db-query.ts";

interface SurrealUserRecord {
  uuid: string;
  username: string;
  password: string;
  displayName: string;
  role: string;
  avatarKey?: string | null;
  avatarMimeType?: string | null;
  createdAt: number;
}

function mapUser(r: SurrealUserRecord): StoredUser {
  return {
    id: r.uuid,
    username: r.username,
    passwordHash: r.password,
    salt: "",
    displayName: r.displayName,
    role: r.role,
    avatarKey: r.avatarKey || undefined,
    createdAt: r.createdAt,
  };
}

export class SurrealUserStore implements UserStore {
  constructor(private readonly db: DatabaseConnection) {}

  async setup(): Promise<void> {
    const schema = [
      "DEFINE TABLE IF NOT EXISTS user SCHEMAFULL",
      "DEFINE FIELD IF NOT EXISTS uuid ON user TYPE string",
      "DEFINE FIELD IF NOT EXISTS username ON user TYPE string",
      "DEFINE FIELD IF NOT EXISTS password ON user TYPE string",
      "DEFINE FIELD IF NOT EXISTS displayName ON user TYPE string",
      "DEFINE FIELD IF NOT EXISTS role ON user TYPE string",
      "DEFINE FIELD IF NOT EXISTS avatarKey ON user TYPE string DEFAULT ''",
      "DEFINE FIELD IF NOT EXISTS avatarMimeType ON user TYPE string DEFAULT ''",
      "DEFINE FIELD IF NOT EXISTS createdAt ON user TYPE number",
      "DEFINE INDEX IF NOT EXISTS idx_username ON TABLE user COLUMNS username UNIQUE",
    ];
    for (const stmt of schema) {
      await this.db.query(stmt);
    }
  }

  async findById(
    id: string,
    fields?: string[],
  ): Promise<StoredUser | null> {
    const select = fields?.length
      ? [...new Set([...fields, "uuid"])].join(", ")
      : "*";
    const result = await this.db.query<[Record<string, unknown>[]]>(
      `SELECT ${select} FROM user WHERE uuid = $uuid LIMIT 1`,
      { uuid: id },
    );
    const record = unwrapFirst(result);
    if (!record) return null;
    if (fields) return record as unknown as StoredUser;
    return mapUser(record as unknown as SurrealUserRecord);
  }

  async findByUsername(
    username: string,
    fields?: string[],
  ): Promise<StoredUser | null> {
    const select = fields?.length
      ? [...new Set([...fields, "uuid"])].join(", ")
      : "*";
    const result = await this.db.query<[Record<string, unknown>[]]>(
      `SELECT ${select} FROM user WHERE username = $username LIMIT 1`,
      { username },
    );
    const record = unwrapFirst(result);
    if (!record) return null;
    if (fields) return record as unknown as StoredUser;
    return mapUser(record as unknown as SurrealUserRecord);
  }

  async createUser(data: NewUserInput): Promise<StoredUser> {
    const parsed = v.parse(NewUserSchema, data);
    const uuid = crypto.randomUUID();
    const createdAt = Date.now();

    try {
      await this.db.query(
        "CREATE user CONTENT $data",
        {
          data: {
            uuid,
            username: parsed.username,
            password: await this.hashPassword(parsed.passwordHash),
            displayName: parsed.displayName,
            role: parsed.role,
            avatarKey: "",
            avatarMimeType: "",
            createdAt,
          },
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.toLowerCase().includes("unique") ||
        msg.toLowerCase().includes("duplicate") ||
        msg.toLowerCase().includes("idx_username")
      ) {
        throw new Error("Username is already taken");
      }
      throw err;
    }

    return {
      id: uuid,
      username: parsed.username,
      passwordHash: "",
      salt: "",
      displayName: parsed.displayName,
      role: parsed.role,
      createdAt,
    };
  }

  async setPassword(id: string, newPassword: string): Promise<void> {
    const result = await this.db.query<[SurrealUserRecord[]]>(
      "UPDATE user MERGE { password: $hash } WHERE uuid = $uuid",
      { uuid: id, hash: await this.hashPassword(newPassword) },
    );
    if (!unwrapFirst(result)) throw new Error(`User ${id} not found`);
  }

  async updateAvatarKey(id: string, key: string): Promise<void> {
    const result = await this.db.query<[SurrealUserRecord[]]>(
      "UPDATE user MERGE { avatarKey: $key } WHERE uuid = $uuid",
      { uuid: id, key },
    );
    if (!unwrapFirst(result)) throw new Error(`User ${id} not found`);
  }

  async findAll(): Promise<StoredUser[]> {
    const result = await this.db.query<[SurrealUserRecord[]]>(
      "SELECT * FROM user ORDER BY createdAt ASC",
    );
    return (result[0] ?? []).map(mapUser);
  }

  async updateRole(id: string, role: string): Promise<void> {
    const result = await this.db.query<[SurrealUserRecord[]]>(
      "UPDATE user MERGE { role: $role } WHERE uuid = $uuid",
      { uuid: id, role },
    );
    if (!unwrapFirst(result)) throw new Error(`User ${id} not found`);
  }

  async changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.findById(id, ["password"]);
    if (!user) throw new Error(`User ${id} not found`);
    const valid = await this.verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new Error("Current password is incorrect");
    await this.setPassword(id, newPassword);
  }

  async deleteUser(id: string): Promise<boolean> {
    const user = await this.findById(id);
    if (!user) return false;

    if (user.avatarKey) {
      try {
        await this.db.query("DELETE avatar_meta WHERE id = $id", { id });
        await this.db.query(`f'avatars:/${id}'.delete()`);
      } catch {
        // best-effort cleanup
      }
    }

    const result = await this.db.query<[SurrealUserRecord[]]>(
      "DELETE user WHERE uuid = $uuid",
      { uuid: id },
    );
    return !!unwrapFirst(result);
  }

  async verifyPassword(
    rawPassword: string,
    passwordHash: string,
  ): Promise<boolean> {
    const [result] = await this.db.query<[boolean]>(
      "RETURN crypto::argon2::compare($hash, $password)",
      { hash: passwordHash, password: rawPassword },
    );
    return result ?? false;
  }

  private async hashPassword(password: string): Promise<string> {
    const [result] = await this.db.query<[string]>(
      "RETURN crypto::argon2::generate($password)",
      { password },
    );
    return result ?? "";
  }
}
