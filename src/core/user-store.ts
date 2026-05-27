// DEVELOPMENT ONLY – In‑memory user store.
// Do not use in production. Replace with a persistent, secure store.

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  role: string;
  createdAt: number;
}

async function sha256(input: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createUserStore() {
  const users = new Map<string, StoredUser>();
  const byUsername = new Map<string, StoredUser>();

  return {
    async createUser(
      username: string,
      password: string,
      displayName: string,
      role = "user",
    ): Promise<StoredUser | null> {
      if (byUsername.has(username)) return null;
      const id = crypto.randomUUID();
      const passwordHash = await sha256(password);
      const user: StoredUser = {
        id,
        username,
        passwordHash,
        displayName,
        role,
        createdAt: Date.now(),
      };
      users.set(id, user);
      byUsername.set(username, user);
      return user;
    },

    findByUsername(username: string): Promise<StoredUser | null> {
      return Promise.resolve(byUsername.get(username) ?? null);
    },

    findById(id: string): Promise<StoredUser | null> {
      return Promise.resolve(users.get(id) ?? null);
    },

    async verifyPassword(
      username: string,
      password: string,
    ): Promise<StoredUser | null> {
      const user = byUsername.get(username);
      if (!user) return null;
      const hash = await sha256(password);
      return hash === user.passwordHash ? user : null;
    },
  };
}
