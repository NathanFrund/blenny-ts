# Punchlist: KV storage layer remaining work

## 1. KV store tests (`tests/kv-store_test.ts`)

The `KvUserStore` and `KvBlobStore` implementations have no unit tests. Requires
`--unstable-kv`. Each test should use `openKvStore("")` for an isolated
in-memory KV instance.

Coverage needed:

- `KvUserStore` — `findById`, `findByUsername`, `createUser` (success +
  duplicate CAS), `updatePasswordHash`, `updateAvatarKey`, `deleteUser`
  (exists + missing)
- `KvBlobStore` — `set`/`getAsResponse` round-trip for small file, `remove`
- Shutdown — verify `kv.close()` is safe after use

## 2. Filesystem BlobStore for memory mode

When `store.driver = "memory"`, avatar endpoints return 501/404. A simple
`FsBlobStore` backed by `static/avatars/` would make the memory mode useful for
local development without `--unstable-kv`.

Location: `src/core/fs-blob-store.ts` (new file)

Interface to implement:

```ts
class FsBlobStore implements BlobStore {
  constructor(private baseDir: string) {}
  set(prefix: string, id: string, file: File): Promise<string>;
  getAsResponse(prefix: string, id: string): Promise<Response>;
  remove(prefix: string, id: string): Promise<void>;
}
```

## 3. Default `db.path` config value

`main.ts:58` passes `config.at("db.path")` to `openKvStore()`, but `db.path` has
no entry in `DEFAULTS` in `config.ts`. This means `Deno.openKv(undefined)` is
called, and Deno picks a platform-dependent default location that is neither
obvious nor predictable.

Add a default to `DEFAULTS`:

```
"db.path": "./data/blenny-kv.sqlite3"
```

Also update `docs/auth-storage.md` and `blenny.example.json`.

## 4. `.gitignore` for KV data

If we set a default `db.path`, the SQLite file should be gitignored. Add to
`.gitignore`:

```
data/
```
