# Auth & Storage Architecture

## Overview

Blenny provides a persistent storage layer out of the box — no database server,
no configuration, no infrastructure. On your laptop it's a SQLite file. On Deno
Deploy it silently becomes FoundationDB replicated across 35 regions. The same
code works in both environments.

Beyond storage, Blenny provides an auth module that handles registration, login,
JWT sessions, and profile picture upload. Each auth module owns its own storage
— it creates and manages its `UserStore` and `BlobStore` instances. The
framework core (`main.ts`, `config.ts`, `AppState`) has no storage awareness.

## Layer Stack

```
┌──────────────────────────────────────────────────┐  ┌──────────────────────────────────────────────┐
│              Auth Module 1                       │  │              Auth Module 2                   │
│  .form-auth/  (KV, zero-infra,                   │  │  form-auth-surreal/ (SurrealDB,              │
│                Deno Deploy)                      │  │                       bucket avatars)        │
│                                                  │  │                                              │
│  initialize():                                   │  │  initialize():                               │
│    1. reads form-auth.store config               │  │    1. connects via SurrealDB SDK             │
│    2. creates UserStore + BlobStore              │  │    2. defines SCHEMAFULL user table          │
│    3. seeds admin user                           │  │    3. defines avatars bucket (try/catch)     │
│    4. sets state.auth                            │  │    4. creates SurrealUserStore               │
│                                                  │  │    5. seeds admin user                       │
│  stop():                                         │  │    6. sets state.auth                        │
│    1. closes Deno.Kv (if KV mode)                │  │                                              │
│                                                  │  │  stop():                                     │
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
│ KvUserStore      │  │ InMemUser │  │ SurrealUserStore │
│ (kv-store.ts)    │  │ Store     │  │ (surreal-        │
│ Deno KV          │  │ (Map)     │  │  store.ts)       │
│ durable          │  │ ephemeral │  │ SurrealDB        │
└──────┬───────────┘  └───────────┘  └────────--─┬──────┘
       │                                         │
       ▼                                         ▼
┌──────────────┐                          ┌──────────────┐
│  Deno.Kv     │                          │  SurrealDB   │
│ Deno.openKv()│                          │  (ws://...)  │
│ SQLite / FDB │                          │              │
└──────────────┘                          └──────────────┘
```

## Interfaces

### UserStore

Every method is async and returns `Promise`.

```ts
interface UserStore {
  findById(id: string): Promise<StoredUser | null>;
  findByUsername(username: string): Promise<StoredUser | null>;
  createUser(data: NewUserInput): Promise<StoredUser>;
  updatePasswordHash(id: string, newHash: string): Promise<void>;
  updateAvatarKey(id: string, key: string): Promise<void>;
  deleteUser(id: string): Promise<boolean>;
}
```

`StoredUser` shape (defined by `UserSchema` in `validation.ts`):

| Field          | Type      | Notes                                                                |
| -------------- | --------- | -------------------------------------------------------------------- |
| `id`           | `string`  | UUID                                                                 |
| `username`     | `string`  | Unique, 1-64 chars                                                   |
| `passwordHash` | `string`  | PBKDF2 hex (KV) or argon2 hash (SurrealDB); `salt` is always `""`    |
| `displayName`  | `string`  | Visible name in UI                                                   |
| `role`         | `string`  | Single role (e.g. "admin", "user", "gm")                             |
| `avatarKey`    | `string?` | Blob key, present only if avatar uploaded                            |
| `createdAt`    | `number`  | Unix millis                                                          |

In the SurrealDB-backed store, `passwordHash` maps to the `password` field in the
`user` table (argon2 hash, generated and verified server-side via
`crypto::argon2::generate/compare`). The `salt` field is always `""` because
SurrealDB handles salting internally.

`NewUserInput` shape:

```ts
interface NewUserInput {
  username: string;
  passwordHash: string; // pre-hashed by caller
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

KV key format: `["blobs", prefix, id]`.

`getAsResponse` returns a streaming HTTP Response with `Content-Type` and `ETag`
headers set from the original file metadata.

## Implementations

### KvUserStore (default)

Location: `src/core/kv-store.ts`

Uses raw Deno KV with two key spaces:

```
["by_username", username]  →  id          (unique, set via atomic CAS)
["users", id]              →  UserData    (the record, minus id field)
```

**Create flow:**

1. Validate input via `v.parse(NewUserSchema)`
2. Generate `id = crypto.randomUUID()`
3. Atomic CAS on `["by_username", username]` (check versionstamp === null)
4. On CAS commit: set both index entry and user record
5. On CAS failure: throw duplicate-username error

**Lookup flow:**

1. `findByUsername`: read index entry, then read user record
2. `findById`: read user record directly
3. Both validate the returned data via `v.safeParse(UserSchema)` — defense
   against storage corruption

### InMemoryUserStore (developer alias)

Location: `src/core/user-store.ts`

Same interface, backed by two `Map`s. Data is ephemeral — lost on process
restart. Used by default when `form-auth.store` is not set, or in unit tests
that don't want `--unstable-kv`.

### KvBlobStore

Location: `src/core/kv-store.ts`

Wraps `@kitsonk/kv-toolbox/blob`:

- `set(prefix, id, file)` → `blob.set(kv, ["blobs", prefix, id], file)` —
  transparently chunks files >64KB, preserves File metadata (name, type)
- `getAsResponse(prefix, id)` → `blob.getAsResponse(kv, ["blobs", prefix, id])`
  — streams directly into Response with correct Content-Type and ETag
- `remove(prefix, id)` → `blob.remove(kv, ["blobs", prefix, id])`

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

Key differences from `KvUserStore`:

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
- Unique constraint on username is enforced via the SurrealQL index, not via
  Deno KV atomic CAS. The `createUser` method catches index-violation errors
  and re-throws as `"Username is already taken"`.

## Configuration

Each auth module owns its config namespace.

### form-auth (KV-backed)

The `.form-auth/` module (dot-prefixed — importable by path, disabled from
auto-discovery because it shares the `"auth"` capability) reads:

| Config key          | Env var                    | Default             | Values               |
| ------------------- | -------------------------- | ------------------- | -------------------- |
| `form-auth.store`   | `BLENNY_FORM_AUTH_STORE`   | `"memory"`          | `"kv"` or `"memory"` |
| `form-auth.db.path` | `BLENNY_FORM_AUTH_DB_PATH` | _(Deno KV default)_ | SQLite path or `""`  |

**store = "kv"**: Deno KV backed by SQLite (local) or FoundationDB (Deploy).
Requires `--unstable-kv`. Full BlobStore support.

**store = "memory"** (default): In-memory Maps. No unstable flags needed. No
BlobStore (blob endpoints return clear error). Data lost on restart.

### form-auth-surreal (SurrealDB-backed)

The `form-auth-surreal` module requires a SurrealDB server. Relevant config keys:

| Config key                  | Env var         | Default    | Values               |
| --------------------------- | --------------- | ---------- | -------------------- |
| `form-auth.bucket.backend`  | —               | `"memory"` | SurrealDB bucket backend |
| `surreal.url`               | `BLENNY_SURREAL_URL` | `ws://127.0.0.1:8000/rpc` | SurrealDB endpoint |
| `surreal.ns`                | `BLENNY_SURREAL_NS`  | `blenny`   | SurrealDB namespace |
| `surreal.db`                | `BLENNY_SURREAL_DB`  | `blenny`   | SurrealDB database  |
| `surreal.user`              | `BLENNY_SURREAL_USER` | `root`    | SurrealDB user      |
| `surreal.pass`              | `BLENNY_SURREAL_PASS` | `root`    | SurrealDB password  |

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
BLENNY_SURREAL_URL=ws://127.0.0.1:8000/rpc deno run main.ts
```

## Password Hashing

Passwords are hashed with PBKDF2 using Deno's built-in `crypto.subtle.deriveKey`
— no WASM, no C bindings, no extra dependencies. 100,000 iterations with a
per-user salt derived from the username.

```ts
async function deriveKey(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return Array.from(new Uint8Array(bits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

The hash is computed in the auth module handler (not the store), and the result
is passed to `UserStore.createUser()` or `UserStore.updatePasswordHash()`. The
sign-in handler derives the candidate hash and compares it against the stored
hash — the store never sees the raw password, and the interface has no
password-aware method.

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
- **Password change**: `updatePasswordHash()` re-hashes via
  `crypto::argon2::generate()` before storing.

No app-side crypto imports, no salt management, no WASM. The `UserStore`
interface's `passwordHash` and `salt` fields are retained for compatibility, but
in the SurrealDB path `salt` is always `""` and `passwordHash` holds the full
argon2 hash string.

## Auth Module Integration

Both modules share the same `"auth"` capability — only one can be active at a
time. The `.form-auth/` module is dot-prefixed to exclude it from auto-discovery
when `form-auth-surreal` is in play.

### form-auth (KV-backed)

`src/modules/.form-auth/` is the zero-infrastructure option. It uses Deno KV
(SQLite locally, FoundationDB on Deno Deploy), needs no external server, and
includes full `BlobStore` support for avatars:

```ts
async initialize(state: AppState) {
  const driver = state.config.at("form-auth.store") ?? "memory";

  if (driver === "kv") {
    const stores = await openKvStore(state.config.at("form-auth.db.path"));
    store = stores.store;
    blobStore = stores.blobStore;
    kv = stores.kv;
  } else {
    store = createInMemoryUserStore();
  }

  state.auth = {
    config: { jwtSecret, cookieName, sessionExpiry, … },
    middleware: createAuthMiddleware(config),
    requireUser: requireUser(),
    requireRole: requireRole,
  };

  const existing = await store.findByUsername("admin");
  if (!existing) {
    await store.createUser({ … });
  }
}

async stop() {
  await kv?.close();
}
```

### form-auth-surreal (SurrealDB-backed)

`src/modules/form-auth-surreal/` requires a running SurrealDB server. It uses
`requireDb()` to get the SurrealDB connection from `state.db`, creates a
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

### form-auth (KV-backed)

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
— `SurrealUserStore` connects to SurrealDB instead of Deno KV:

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
point at `src/modules/form-auth-surreal/index.ts` wires it together — no changes
to `main.ts`, `config.ts`, or `app-state.ts`.

## Testing

| Test                  | Store                      | Flag              | File                            |
| --------------------- | -------------------------- | ----------------- | ------------------------------- |
| Auth flow             | InMemoryUserStore          | none              | `tests/form-auth_test.ts`       |
| UserStore CRUD        | InMemoryUserStore          | none              | `tests/user-store_test.ts`      |
| KvUserStore CRUD      | KvUserStore (in-memory KV) | `--unstable-kv`   | `tests/kv-store_test.ts`        |
| BlobStore             | KvBlobStore (in-memory KV) | `--unstable-kv`   | `tests/kv-store_test.ts`        |
| SurrealUserStore CRUD | SurrealUserStore           | `BLENNY_SURREAL_URL` | `tests/surreal-store_test.ts` |

The in-memory store backs all standard tests — no flag changes needed in the
default `deno test` task. The SurrealUserStore test requires `BLENNY_SURREAL_URL`
to be set and is silently skipped otherwise.

KV store tests use `openKvStore("")` to create an isolated in-memory KV instance
per test:

```ts
const { store, blobStore } = await openKvStore("");
// test with these clean instances
```
