# Auth & Storage Architecture

## Overview

Blenny provides a persistent storage layer out of the box — no database server,
no configuration, no infrastructure. On your laptop it's a SQLite file handled by
Bun's built-in `bun:sqlite` driver, with blobs written to the filesystem. No
external services required.

Beyond storage, Blenny provides an auth module that handles registration, login,
JWT sessions, and profile picture upload. Each auth module owns its own storage
— it creates and manages its `UserStore` and `BlobStore` instances. The
framework core (`main.ts`, `config.ts`, `AppState`) has no storage awareness.

## Layer Stack

```
┌──────────────────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
│              Auth Module 1                       │  │              Auth Module 2                   │
│  .form-auth-kv/  (SQLite + FsBlobStore,          │  │  form-auth-surreal/ (SurrealDB,              │
│                   zero-infra)                    │  │                       bucket avatars)        │
│                                                  │  │                                              │
│  initialize():                                   │  │  initialize():                               │
│    1. reads form-auth.store config               │  │    1. connects via SurrealDB SDK             │
│    2. opens SQLite UserStore + FsBlobStore       │  │    2. defines SCHEMAFULL user table          │
│       (or InMemory + FsBlobStore)                │  │    3. defines avatars bucket (try/catch)     │
│    3. seeds admin user                           │  │    4. creates SurrealUserStore               │
│    4. sets state.auth                            │  │    5. seeds admin user                       │
│                                                  │  │    6. sets state.auth                        │
│  stop():                                         │  │                                              │
│    1. closes the SQLite database                 │  │  stop():                                     │
│                                                  │  │    (core manages SurrealDB connection)       │
└──────────────────┬───────────────────────────────┘  └──────────────────┬───────────────────────────┘
                   │                                                     │
                   │  only one active (both claim "auth")                │
                   └──────────┬───────────────────────────────────────-──┘
                              │ owns instances
                              ▼
                   ┌─────────────────────────────────────┐
                   │      Interface Layer (store.ts)     │
                   │        UserStore  /  BlobStore      │
                   └──┬──────────────┬───────────────────┘
                      │              │
              ┌───────┴───────┐      └──────┐
              ▼               ▼             ▼
┌──────────────────┐  ┌───────────┐  ┌──────────────────┐
│ SqliteUserStore  │  │ InMemUser │  │ SurrealUserStore │
│ (sqlite-user-    │  │ Store     │  │ (surreal-        │
│  store.ts)       │  │ (Map)     │  │  store.ts)       │
│ bun:sqlite       │  │ ephemeral │  │ SurrealDB        │
│ durable          │  └───────────┘  └────────--─┬──────┘
└──────┬───────────┘                             │
       ▼                                         ▼
┌──────────────┐                          ┌──────────────┐
│  SQLite file │                          │  SurrealDB   │
│ new Database │                          │  (ws://...)  │
│ ./data/...   │                          │              │
└──────────────┘                          └──────────────┘

BlobStore: FsBlobStore (fs-blob-store.ts) → files under ./data/blobs/{prefix}/
```

## Interfaces

### UserStore

Every method is async and returns `Promise`.

```ts
interface UserStore {
  findById(id: string, fields?: string[]): Promise<StoredUser | null>;
  findByUsername(
    username: string,
    fields?: string[],
  ): Promise<StoredUser | null>;
  findAll(): Promise<StoredUser[]>;
  createUser(data: NewUserInput): Promise<StoredUser>;
  setPassword(id: string, newPassword: string): Promise<void>;
  updateAvatarKey(id: string, key: string): Promise<void>;
  updateRole(id: string, role: string): Promise<void>;
  changePassword(
    id: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
}
```

`StoredUser` shape (defined by `UserSchema` in `validation.ts`):

| Field          | Type      | Notes                                                                     |
| -------------- | --------- | ------------------------------------------------------------------------- |
| `id`           | `string`  | UUID                                                                      |
| `username`     | `string`  | Unique, 1-64 chars                                                        |
| `passwordHash` | `string`  | PBKDF2 hex (SQLite) or argon2 hash (SurrealDB)                            |
| `salt`         | `string`  | Per-user PBKDF2 salt (SQLite); always `""` on the SurrealDB path          |
| `displayName`  | `string`  | Visible name in UI                                                        |
| `role`         | `string`  | Single role (e.g. "admin", "user", "gm")                                  |
| `avatarKey`    | `string?` | Blob key, present only if avatar uploaded                                 |
| `createdAt`    | `number`  | Unix millis                                                               |

In the SurrealDB-backed store, `passwordHash` maps to the `password` field in the
`user` table (argon2 hash, generated and verified server-side via
`crypto::argon2::generate/compare`). The `salt` field is always `""` because
SurrealDB handles salting internally.

`NewUserInput` shape (`NewUserSchema` in `validation.ts`):

```ts
interface NewUserInput {
  username: string;
  passwordHash: string; // pre-hashed by caller
  salt: string; // PBKDF2 salt (use "" on the SurrealDB path)
  displayName: string;
  role?: string; // defaults to "user"
}
```

### BlobStore

A single interface for all binary file storage — avatars, campaign maps,
character sheets, whatever.

```ts
interface BlobStore {
  /** Store a file.  Returns a key of the form "{prefix}:{id}". */
  set(prefix: string, id: string, file: File): Promise<string>;

  /** Stream as HTTP Response.  404 if missing. */
  getAsResponse(prefix: string, id: string): Promise<Response>;

  /** Delete.  Safe to call if missing. */
  remove(prefix: string, id: string): Promise<void>;
}
```

The `prefix` groups related files — use `"avatars"` for profile pictures,
`"maps"` for campaign maps, `"sheets"` for character sheets, etc. The `id` is
the owning entity's identifier (a userId, a gameId, etc.).

The returned key is `"{prefix}:{id}"`.

`getAsResponse` returns an HTTP Response with `Content-Type` set from the
original file metadata, and a `Content-Length`. Missing blobs return `404`.

## Implementations

### SqliteUserStore (default, durable)

Location: `src/core/sqlite-user-store.ts` (opened via `src/core/sqlite-store.ts`)

Backed by `bun:sqlite`. The constructor enables WAL mode and creates the table if
missing:

```sql
PRAGMA journal_mode = WAL;

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
```

Open a store with `openSqliteStore(dbPath, blobStore)`, which returns
`{ db, store, blobStore }` (a `Database`, a `SqliteUserStore`, and the blob
store). Use `":memory:"` for an ephemeral, per-test instance.

**Create flow:**

1. Validate input via `v.parse(NewUserSchema)`
2. Generate `id = crypto.randomUUID()`
3. `INSERT` — the `UNIQUE` constraint on `username` enforces uniqueness
4. On violation, the error is re-thrown as `"Username is already taken"`

**Lookup flow:**

1. `findByUsername` / `findById` run a `SELECT` and map the row
2. Rows are validated via `v.safeParse(UserSchema)` — defense against storage
   corruption
3. `rowToUserData()` **omits** `avatarKey` when the column is `NULL` because
   `UserSchema` declares it `v.optional(v.string())`, which rejects `null`

`deleteUser()` also removes the user's avatar blob via `blobStore.remove("avatars", id)`.

### InMemoryUserStore (developer alias)

Location: `src/core/user-store.ts`

Same interface, backed by a `Map`. Data is ephemeral — lost on process restart.
Used when `form-auth.store` is not set to `"sqlite"`/`"kv"`, and in unit tests
that don't want a database file.

### FsBlobStore

Location: `src/core/fs-blob-store.ts`

Stores each file on disk under `baseDir` (default `./data/blobs`):

- `set(prefix, id, file)` → writes `{baseDir}/{prefix}/{id}` and a sidecar
  `{baseDir}/{prefix}/{id}.type` holding the MIME type (defaulting to
  `application/octet-stream`). Returns `"{prefix}:{id}"`.
- `getAsResponse(prefix, id)` → reads both files and returns a `Response` with
  the stored `Content-Type` and `Content-Length`; missing files return `404`.
- `remove(prefix, id)` → unlinks both files (safe if missing).

### SurrealUserStore

Location: `src/core/surreal-store.ts`

Backed by a SurrealDB SCHEMAFULL `user` table with the following definition:

```
DEFINE TABLE IF NOT EXISTS user SCHEMAFULL
DEFINE FIELD IF NOT EXISTS uuid       ON user TYPE string
DEFINE FIELD IF NOT EXISTS username   ON user TYPE string
DEFINE FIELD IF NOT EXISTS password   ON user TYPE string
DEFINE FIELD IF NOT EXISTS displayName ON user TYPE string
DEFINE FIELD IF NOT EXISTS role       ON user TYPE string
DEFINE FIELD IF NOT EXISTS avatarKey  ON user TYPE string DEFAULT ''
DEFINE FIELD IF NOT EXISTS avatarMimeType ON user TYPE string DEFAULT ''
DEFINE FIELD IF NOT EXISTS createdAt  ON user TYPE number
DEFINE INDEX IF NOT EXISTS idx_username ON TABLE user COLUMNS username UNIQUE
```

Key differences from `SqliteUserStore`:

- The `password` field stores the raw argon2 hash from
  `crypto::argon2::generate()` — app-side crypto is absent entirely.
- `avatarKey` and `avatarMimeType` use `DEFAULT ''` instead of `NONE` because
  SCHEMAFULL rejects `NONE` for string fields. `mapUser()` converts `""` back to
  `undefined` when building the `StoredUser` interface.
- Password verification delegates to
  `RETURN crypto::argon2::compare($hash, $password)` in SurrealQL.
- Avatar blobs use SurrealDB buckets (`DEFINE BUCKET avatars`) instead of a
  `BlobStore` implementation. The bucket is defined in a try/catch — if the
  SurrealDB server lacks `--experimental-files`, a warning is logged and avatar
  endpoints fail at call time.
- Unique constraint on username is enforced via the SurrealQL index, not via a
  SQLite `UNIQUE` constraint. The `createUser` method catches index-violation
  errors and re-throws as `"Username is already taken"`.

## Configuration

Each auth module owns its config namespace.

### form-auth (SQLite-backed)

The `.form-auth-kv/` module (dot-prefixed — importable by path, disabled from
auto-discovery because it shares the `"auth"` capability) reads:

| Config key          | Env var                    | Default                | Values                        |
| ------------------- | -------------------------- | ---------------------- | ----------------------------- |
| `form-auth.store`   | `BLENNY_FORM_AUTH_STORE`   | `"memory"`             | `"sqlite"`/`"kv"`, or `"memory"` |
| `form-auth.db.path` | `BLENNY_FORM_AUTH_DB_PATH` | `"./data/blenny.sqlite"` | SQLite path or `""`         |

**store = "sqlite"** (or the legacy alias `"kv"`; recommended for production):
SQLite backed by a file on disk via `bun:sqlite`. Provides persistent,
disk-backed storage — data survives restarts. Full `BlobStore` support via
`FsBlobStore`.

**store = "memory"** (default): In-memory `Map`. Data lost on restart.
`FsBlobStore` is still used for blobs. Dev-only; switch to `"sqlite"` for any
persistent deployment.

### form-auth-surreal (SurrealDB-backed)

The `form-auth-surreal` module requires a SurrealDB server. Relevant config
keys:

| Config key                 | Env var               | Default                   | Values                   |
| -------------------------- | --------------------- | ------------------------- | ------------------------ |
| `form-auth.bucket.backend` | —                     | `"memory"`                | SurrealDB bucket backend |
| `surreal.url`              | `BLENNY_SURREAL_URL`  | `ws://127.0.0.1:8000/rpc` | SurrealDB endpoint       |
| `surreal.ns`               | `BLENNY_SURREAL_NS`   | `blenny`                  | SurrealDB namespace      |
| `surreal.db`               | `BLENNY_SURREAL_DB`   | `blenny`                  | SurrealDB database       |
| `surreal.user`             | `BLENNY_SURREAL_USER` | `root`                    | SurrealDB user           |
| `surreal.pass`             | `BLENNY_SURREAL_PASS` | `root`                    | SurrealDB password       |

The `form-auth.bucket.backend` config controls which storage backend SurrealDB
uses for the avatar bucket (see [SurrealDB files docs][surreal-files]). The
bucket is defined with `DEFINE BUCKET IF NOT EXISTS avatars BACKEND $backend`
during module initialization. If `--experimental-files` is not enabled on the
server, the `DEFINE BUCKET` call fails and a warning is logged — avatar
endpoints will fail at call time but the rest of auth still works.

[surreal-files]: https://surrealdb.com/docs/surrealql/statements/define/bucket

Set via `blenny.json`:

```json
{
  "surreal.url": "ws://127.0.0.1:8000/rpc",
  "form-auth.bucket.backend": "file"
}
```

Or env var:

```sh
BLENNY_SURREAL_URL=ws://127.0.0.1:8000/rpc bun run main.ts
```

## Password Hashing

Passwords are hashed with PBKDF2 using Web Crypto (`crypto.subtle`) — available
in Bun with no WASM, no C bindings, no extra dependencies. 100,000 iterations
with SHA-256 and a per-user random salt.

```ts
function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function deriveKey(
  password: string,
): Promise<{ hash: string; salt: string }> {
  const salt = generateSalt();
  const hash = await pbkdf2(password, salt);
  return { hash, salt };
}

export async function verifyKey(
  password: string,
  salt: string,
): Promise<string> {
  return await pbkdf2(password, salt);
}
```

The hash is computed in the auth module handler (not the store), and the result
is passed to `UserStore.createUser()`. The store's `setPassword()` /
`changePassword()` methods hash before storing — the interface never exposes a
pre-hashing step. The sign-in handler derives the candidate hash and compares it
against the stored hash — the store never sees the raw password, and the
interface has no password-aware method.

Upgrade path: if you need argon2 or bcrypt, you can swap the handler-side hash
function without touching the store or the interface. PBKDF2 covers the needs of
every realistic Blenny deployment.

### SurrealDB Path (argon2)

When using `form-auth-surreal`, password hashing moves entirely to SurrealDB:

- **Registration**: `SurrealUserStore.createUser()` calls
  `RETURN crypto::argon2::generate($password)` in SurrealQL. The returned hash
  is stored in the `password` field. The app never sees the raw password.
- **Sign-in**: `SurrealUserStore.verifyPassword()` calls
  `RETURN crypto::argon2::compare($hash, $password)` in SurrealQL. The boolean
  result is returned directly.
- **Password change**: `setPassword()` hashes the raw password via
  `crypto::argon2::generate()` before storing.

No app-side crypto imports, no salt management, no WASM. The `UserStore`
interface's `passwordHash` and `salt` fields are retained for compatibility, but
in the SurrealDB path `salt` is always `""` and `passwordHash` holds the full
argon2 hash string.

## Auth Module Integration

Both modules share the same `"auth"` capability — only one can be active at a
time. The `.form-auth-kv/` module is dot-prefixed to exclude it from
auto-discovery when `form-auth-surreal` is in play.

### form-auth (SQLite-backed)

`src/modules/auth/.form-auth-kv/` is the zero-infrastructure option. It uses
SQLite (plus `FsBlobStore` for avatars), needs no external server, and includes
full `BlobStore` support:

```ts
async initialize(state_: AppState) {
  const driver = state_.config.at("form-auth.store") ?? "memory";

  if (driver === "sqlite" || driver === "kv") {
    const dbPath = state_.config.at("form-auth.db.path") ||
      "./data/blenny.sqlite";
    const stores = openSqliteStore(dbPath, new FsBlobStore());
    state.store = stores.store;
    state.blobStore = stores.blobStore;
    state.db = stores.db;
  } else {
    state.store = createInMemoryUserStore();
    state.blobStore = new FsBlobStore();
  }

  state_.auth = {
    config: { jwtSecret, cookieName, sessionExpiry, … },
    middleware: createAuthMiddleware(state.config),
    requireUser: requireUser(),
    requireRole: requireRole,
  };

  const existing = await state.store.findByUsername("admin");
  if (!existing) {
    const { hash, salt } = await deriveKey("admin");
    await state.store.createUser({ … });
  }
}

async stop() {
  state.db?.close();
}
```

### form-auth-surreal (SurrealDB-backed)

`src/modules/auth/form-auth-surreal/` requires a running SurrealDB server. It
uses `requireDb()` to get the SurrealDB connection from `state.db`, creates a
`SurrealUserStore`, defines the bucket, and seeds the admin user:

```ts
async initialize(state_: AppState) {
  state.conduit = state_.conduit;
  state.config = {
    jwtSecret: state_.config.jwtSecret,
    cookieName: state_.config.cookieName,
    sessionExpiry: state_.config.sessionDurationHours * 3600,
    secureCookies: !state_.config.devMode,
    allowQueryToken: false,
  };

  const db = requireDb(state_.db, "form-auth-surreal");
  state.db = db;

  const store = new SurrealUserStore(db);
  await store.setup();

  const backend = state_.config.at("form-auth.bucket.backend") ?? "memory";
  try {
    await db.query(
      "DEFINE BUCKET IF NOT EXISTS avatars BACKEND $backend",
      { backend },
    );
  } catch (err) {
    // log warning — bucket not available, avatars will fail at call time
  }

  state.store = store;

  state_.auth = {
    config: state.config,
    middleware: createAuthMiddleware(state.config),
    requireUser: requireUser(),
    requireRole: requireRole,
  };

  const existing = await state.store.findByUsername("admin");
  if (!existing) {
    await state.store.createUser({
      username: "admin",
      passwordHash: "admin",
      salt: "",
      displayName: "Administrator",
      role: "admin",
    });
  }
}
```

### Routes

| Method | Path               | Auth   | Handler                              |
| ------ | ------------------ | ------ | ------------------------------------ |
| GET    | `/auth/signin`     | —      | Render login form                    |
| POST   | `/auth/signin`     | —      | Validate credentials, set JWT cookie |
| GET    | `/auth/register`   | —      | Render register form                 |
| POST   | `/auth/register`   | —      | Create user, set JWT cookie          |
| POST   | `/auth/signout`    | —      | Clear JWT cookie                     |
| POST   | `/auth/avatar`     | `true` | Upload profile picture               |
| GET    | `/avatars/:userId` | —      | Serve profile picture                |

### form-auth (SQLite-backed)

Avatar upload validates the file is an `image/*` type, stores it via
`state.blobStore.set("avatars", userId, file)`, and records the returned key via
`state.store.updateAvatarKey(userId, key)`.

Avatar serving reads the userId from the URL parameter and calls
`state.blobStore.getAsResponse("avatars", userId)` directly — the key is
deterministic so there is no need to parse the stored key.

### form-auth-surreal (bucket-backed)

In the SurrealDB variant, avatars use SurrealDB buckets instead of `BlobStore`.
The upload handler writes directly to the `avatars` bucket via SurrealQL, and
the serve handler reads from it. The `avatarKey` and `avatarMimeType` fields on
the user record store the bucket file key and Content-Type.

## Swapping Backends

The interface design makes swapping storage backends a matter of writing a new
class implementing `UserStore`. The `form-auth-surreal` module demonstrates this
— `SurrealUserStore` connects to SurrealDB instead of SQLite:

```ts
class SurrealUserStore implements UserStore {
  constructor(private readonly db: Surreal) {}

  async setup(): Promise<void> {
    // SCHEMAFULL table with argon2 password, bucket-ready avatar fields
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
    for (const stmt of schema) await this.db.query(stmt);
  }

  async createUser(data: NewUserInput): Promise<StoredUser> {
    // validates input, generates UUID, hashes password via
    // RETURN crypto::argon2::generate($password) in SurrealQL,
    // CREATE user CONTENT $data
  }

  async verifyPassword(raw: string, hash: string): Promise<boolean> {
    // RETURN crypto::argon2::compare($hash, $password)
  }

  private async hashPassword(password: string): Promise<string> {
    const [result] = await this.db.query<[string]>(
      "RETURN crypto::argon2::generate($password)",
      { password },
    );
    return result ?? "";
  }
}
```

The full implementation lives in `src/core/surreal-store.ts`. The module entry
point at `src/modules/auth/form-auth-surreal/index.ts` wires it together — no
changes to `main.ts`, `config.ts`, or `app-state.ts`.

## Testing

| Test                  | Store                       | Flag                 | File                               |
| --------------------- | --------------------------- | -------------------- | ---------------------------------- |
| Auth flow             | InMemoryUserStore           | none                 | `tests/form-auth_test.ts`          |
| UserStore CRUD        | InMemoryUserStore           | none                 | `tests/user-store_test.ts`         |
| SqliteUserStore CRUD  | SqliteUserStore (`:memory:`) | none                | `tests/sqlite-user-store_test.ts`  |
| BlobStore             | FsBlobStore (temp dir)      | none                 | `tests/fs-blob-store_test.ts`      |
| SurrealUserStore CRUD | SurrealUserStore            | `BLENNY_SURREAL_URL` | `tests/surreal-store_test.ts`      |

The in-memory store backs all standard tests — no special flags needed in the
default `bun test` task. The SurrealUserStore test requires `BLENNY_SURREAL_URL`
to be set and is skipped otherwise.

SQLite store tests use `openSqliteStore(":memory:", new FsBlobStore(...))` to
create an isolated instance per test:

```ts
const stores = openSqliteStore(":memory:", new FsBlobStore(tmpDir));
// test with these clean instances
```
