import type { Database } from "bun:sqlite";
import * as v from "@valibot/valibot";
import { deriveKey, verifyKey } from "./crypto.ts";
import type { BlobStore, StoredUser, UserStore } from "./store.ts";
import type { NewUserInput, UserData } from "./validation.ts";
import { NewUserSchema, UserSchema } from "./validation.ts";

interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  displayName: string;
  role: string;
  avatarKey: string | null;
  createdAt: number;
}

export class SqliteUserStore implements UserStore {
  constructor(
    private readonly db: Database,
    private readonly blobStore: BlobStore,
  ) {
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id           TEXT PRIMARY KEY,
        username     TEXT NOT NULL UNIQUE,
        passwordHash TEXT NOT NULL,
        salt         TEXT NOT NULL,
        displayName  TEXT NOT NULL,
        role         TEXT NOT NULL,
        avatarKey    TEXT,
        createdAt    INTEGER NOT NULL
      );
    `);
  }

  // Mirror the KV shape: avatarKey is ABSENT when not set, not null.
  // UserSchema declares avatarKey as optional(string), which rejects null.
  private rowToUserData(row: UserRow): Record<string, unknown> {
    const data: Record<string, unknown> = {
      username: row.username,
      passwordHash: row.passwordHash,
      salt: row.salt,
      displayName: row.displayName,
      role: row.role,
      createdAt: row.createdAt,
    };
    if (row.avatarKey !== null) data.avatarKey = row.avatarKey;
    return data;
  }

  private toStored(row: UserRow): StoredUser | null {
    const parsed = v.safeParse(UserSchema, this.rowToUserData(row));
    if (!parsed.success) return null;
    return { ...parsed.output, id: row.id };
  }

  async findById(id: string, _fields?: string[]): Promise<StoredUser | null> {
    const row = this.db.query("SELECT * FROM users WHERE id = ?").get(id) as UserRow | null;
    return row ? this.toStored(row) : null;
  }

  async findByUsername(username: string, _fields?: string[]): Promise<StoredUser | null> {
    const row = this.db.query("SELECT * FROM users WHERE username = ?").get(username) as UserRow | null;
    return row ? this.toStored(row) : null;
  }

  async findAll(): Promise<StoredUser[]> {
    const rows = this.db.query("SELECT * FROM users").all() as UserRow[];
    return rows.map((r) => this.toStored(r)).filter((u): u is StoredUser => u !== null);
  }

  async createUser(data: NewUserInput): Promise<StoredUser> {
    const parsed = v.parse(NewUserSchema, data);
    const id = crypto.randomUUID();
    const user: UserData = {
      username: parsed.username,
      passwordHash: parsed.passwordHash,
      salt: parsed.salt,
      displayName: parsed.displayName,
      role: parsed.role,
      createdAt: Date.now(),
    };

    try {
      this.db
        .query(`
          INSERT INTO users
            (id, username, passwordHash, salt, displayName, role, avatarKey, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
        `)
        .run(id, user.username, user.passwordHash, user.salt, user.displayName, user.role, user.createdAt);
    } catch (err) {
      // Preserve the exact message from the KV implementation.
      if (String(err).includes("UNIQUE constraint failed")) {
        throw new Error("Username is already taken");
      }
      throw err;
    }

    return { ...user, id };
  }

  async setPassword(id: string, newPassword: string): Promise<void> {
    const { hash, salt } = await deriveKey(newPassword);
    const result = this.db.query("UPDATE users SET passwordHash = ?, salt = ? WHERE id = ?").run(hash, salt, id);
    if (result.changes === 0) throw new Error(`User ${id} not found`);
  }

  async updateAvatarKey(id: string, key: string): Promise<void> {
    const result = this.db.query("UPDATE users SET avatarKey = ? WHERE id = ?").run(key, id);
    if (result.changes === 0) throw new Error(`User ${id} not found`);
  }

  async updateRole(id: string, role: string): Promise<void> {
    const result = this.db.query("UPDATE users SET role = ? WHERE id = ?").run(role, id);
    if (result.changes === 0) throw new Error(`User ${id} not found`);
  }

  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    const row = this.db.query("SELECT salt, passwordHash FROM users WHERE id = ?").get(id) as {
      salt: string;
      passwordHash: string;
    } | null;
    if (!row) throw new Error(`User ${id} not found`);

    const hash = await verifyKey(currentPassword, row.salt);
    if (row.passwordHash !== hash) {
      throw new Error("Current password is incorrect");
    }
    await this.setPassword(id, newPassword);
  }

  async deleteUser(id: string): Promise<boolean> {
    const row = this.db.query("SELECT avatarKey FROM users WHERE id = ?").get(id) as {
      avatarKey: string | null;
    } | null;
    if (!row) return false;

    this.db.query("DELETE FROM users WHERE id = ?").run(id);

    if (row.avatarKey) {
      await this.blobStore.remove("avatars", id);
    }
    return true;
  }
}
