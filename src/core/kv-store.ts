import * as v from "@valibot/valibot";
import * as blob from "@kitsonk/kv-toolbox/blob";
import { NewUserSchema, UserSchema } from "./validation.ts";
import type { NewUserInput, UserData } from "./validation.ts";
import type { BlobStore, StoredUser, UserStore } from "./store.ts";

// ── KvUserStore ────────────────────────────────────────────────

export class KvUserStore implements UserStore {
  constructor(private readonly kv: Deno.Kv) {}

  async findById(id: string): Promise<StoredUser | null> {
    const result = await this.kv.get<UserData>(["users", id]);
    if (!result.value) return null;
    const parsed = v.safeParse(UserSchema, result.value);
    if (!parsed.success) return null;
    return { ...parsed.output, id };
  }

  async findByUsername(username: string): Promise<StoredUser | null> {
    const index = await this.kv.get<string>(["by_username", username]);
    if (!index.value) return null;
    return this.findById(index.value);
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

    const result = await this.kv.atomic()
      .check({ key: ["by_username", user.username], versionstamp: null })
      .set(["by_username", user.username], id)
      .set(["users", id], user)
      .commit();

    if (!result.ok) {
      throw new Error("Username is already taken");
    }

    return { ...user, id };
  }

  async updatePasswordHash(id: string, newHash: string): Promise<void> {
    const doc = await this.kv.get<UserData>(["users", id]);
    if (!doc.value) throw new Error(`User ${id} not found`);
    await this.kv.set(["users", id], { ...doc.value, passwordHash: newHash });
  }

  async updateAvatarKey(id: string, key: string): Promise<void> {
    const doc = await this.kv.get<UserData>(["users", id]);
    if (!doc.value) throw new Error(`User ${id} not found`);
    await this.kv.set(["users", id], { ...doc.value, avatarKey: key });
  }

  async deleteUser(id: string): Promise<boolean> {
    const doc = await this.kv.get<UserData>(["users", id]);
    if (!doc.value) return false;
    await this.kv.atomic()
      .delete(["users", id])
      .delete(["by_username", doc.value.username])
      .commit();
    if (doc.value.avatarKey) {
      await blob.remove(this.kv, ["blobs", "avatars", id]);
    }
    return true;
  }
}

// ── KvBlobStore ─────────────────────────────────────────────────

export class KvBlobStore implements BlobStore {
  constructor(private readonly kv: Deno.Kv) {}

  private key(prefix: string, id: string): ["blobs", string, string] {
    return ["blobs", prefix, id];
  }

  async set(prefix: string, id: string, file: File): Promise<string> {
    await blob.set(this.kv, this.key(prefix, id), file);
    return `${prefix}:${id}`;
  }

  getAsResponse(prefix: string, id: string): Promise<Response> {
    return blob.getAsResponse(this.kv, this.key(prefix, id));
  }

  async remove(prefix: string, id: string): Promise<void> {
    await blob.remove(this.kv, this.key(prefix, id));
  }
}

// ── Factory ─────────────────────────────────────────────────────

export interface KvStores {
  store: KvUserStore;
  blobStore: KvBlobStore;
  kv: Deno.Kv;
}

export async function openKvStore(path?: string): Promise<KvStores> {
  const kv = await Deno.openKv(path);
  return {
    kv,
    store: new KvUserStore(kv),
    blobStore: new KvBlobStore(kv),
  };
}
