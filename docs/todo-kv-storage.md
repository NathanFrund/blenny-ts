# Punchlist: KV storage layer remaining work

## Done (merged to main)

- KvUserStore, KvBlobStore, openKvStore factory (src/core/kv-store.ts)
- KvUserStore + KvBlobStore + openKvStore tests (tests/kv-store_test.ts, 19 steps)
- FsBlobStore for memory mode avatar serving (src/core/fs-blob-store.ts)
- FsBlobStore tests (tests/fs-blob-store_test.ts, 6 steps)
- Module stop() lifecycle tests for KV close in both memory and KV modes
- data/ in .gitignore
- Empty db.path handling ("" → undefined for Deno.openKv)
- --unstable-kv and --allow-write in test task

## Remaining

### 1. Avatar upload/serve handler tests

The `POST /auth/avatar` and `GET /avatars/:userId` routes have no request-level
tests. The underlying BlobStore implementations (FsBlobStore, KvBlobStore) are
tested, but the full handler flow (auth guard, file validation, store wiring)
is uncovered.

Testing challenges:
- Needs multipart form upload with a File
- Needs authenticated session (cookie from signin)
- Needs to exercise the FsBlobStore in memory mode
- Avatar serve handler depends on a user record with an avatarKey set
