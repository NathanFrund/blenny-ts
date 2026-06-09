import type { NewUserInput } from "./validation.ts";
import type { StoredUser } from "./store.ts";
import { deriveKey, verifyKey } from "./crypto.ts";

export function createInMemoryUserStore() {
  const users = new Map<string, StoredUser>();
  const byUsername = new Map<string, StoredUser>();

  const findByUsername = (
    username: string,
    _fields?: string[],
  ): Promise<StoredUser | null> => {
    return Promise.resolve(byUsername.get(username) ?? null);
  };

  const findById = (
    id: string,
    _fields?: string[],
  ): Promise<StoredUser | null> => {
    return Promise.resolve(users.get(id) ?? null);
  };

  return {
    findById,

    findByUsername,

    createUser(data: NewUserInput): Promise<StoredUser> {
      if (byUsername.has(data.username)) {
        return Promise.reject(new Error("Username is already taken"));
      }
      const id = crypto.randomUUID();
      const user: StoredUser = {
        id,
        username: data.username,
        passwordHash: data.passwordHash,
        salt: data.salt,
        displayName: data.displayName,
        role: data.role ?? "user",
        createdAt: Date.now(),
      };
      users.set(id, user);
      byUsername.set(data.username, user);
      return Promise.resolve(user);
    },

    updatePasswordHash(id: string, newHash: string): Promise<void> {
      const user = users.get(id);
      if (!user) return Promise.reject(new Error(`User ${id} not found`));
      user.passwordHash = newHash;
      return Promise.resolve();
    },

    updateAvatarKey(id: string, key: string): Promise<void> {
      const user = users.get(id);
      if (!user) return Promise.reject(new Error(`User ${id} not found`));
      user.avatarKey = key;
      return Promise.resolve();
    },

    deleteUser(id: string): Promise<boolean> {
      const user = users.get(id);
      if (!user) return Promise.resolve(false);
      users.delete(id);
      byUsername.delete(user.username);
      return Promise.resolve(true);
    },

    findAll(): Promise<StoredUser[]> {
      return Promise.resolve(Array.from(users.values()));
    },

    updateRole(id: string, role: string): Promise<void> {
      const user = users.get(id);
      if (!user) return Promise.reject(new Error(`User ${id} not found`));
      user.role = role;
      return Promise.resolve();
    },

    async changePassword(
      id: string,
      currentPassword: string,
      newPassword: string,
    ): Promise<void> {
      const user = users.get(id);
      if (!user) throw new Error(`User ${id} not found`);
      const hash = await verifyKey(currentPassword, user.salt);
      if (user.passwordHash !== hash) {
        throw new Error("Current password is incorrect");
      }
      const { hash: newHash, salt: newSalt } = await deriveKey(newPassword);
      user.passwordHash = newHash;
      user.salt = newSalt;
    },
  };
}
