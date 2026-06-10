# Database Access from Modules

Modules interact with the database through two distinct paths depending on what
they need:

| Path                                    | When to use                                                     |
| --------------------------------------- | --------------------------------------------------------------- |
| `state.store` (UserStore)               | Standard user CRUD — find, create, update role/password, delete |
| `state.db.query()` (DatabaseConnection) | Custom business-logic tables, SurrealQL-specific features, DDL  |

---

## Lifecycle

The database connection is created during boot **before** any module's
`initialize()` runs, and closed after all modules have stopped.

```
boot → connectDatabase() → module.initialize() → ... → stopModules() → db.close()
```

A module receives the database in two forms:

```ts
interface AppState {
  db?: DatabaseConnection; // Raw query interface, optional at boot
  store?: UserStore; // Domain-level CRUD, set by the auth module
}
```

Both are optional because:

- `db` may be absent if no database driver is configured (e.g. Deno.Kv-only
  deployments)
- `store` is set by whichever auth module loads first (Surreal, Kv, or
  in-memory)

Guard at the top of `initialize()` to fail fast if a dependency is missing:

```ts
const db = requireDb(state_.db, "my-module");
```

---

## Pattern 1: Standard CRUD via `state.store`

When you need user data — find, create, update role, change password, delete —
use the `UserStore` interface. This keeps your module backend-agnostic (it works
identically with SurrealDB, Deno.Kv, or in-memory stores).

```ts
let store: NonNullable<AppState["store"]>;

const myModule: BlennyModule = {
  name: "my-module",
  requires: ["auth"],
  initialize(state_: AppState) {
    store = state_.store!;
  },
};
```

```ts
// Single user
const user = await store.findById(id);
const byName = await store.findByUsername("alice");

// Only fetch specific fields (SurrealDB backend reduces wire data)
const partial = await store.findById(id, ["password", "role"]);

// All users
const all = await store.findAll();

// Mutations
await store.createUser(data);
await store.updateRole(id, "admin");
await store.changePassword(id, currentPassword, newPassword);
await store.updateAvatarKey(id, "avatars:abc123");
await store.deleteUser(id);
```

**When to use projection (`fields` param):**

The `fields` parameter on `findById` / `findByUsername` is a hint to the
SurrealQL backend to SELECT only those columns, reducing data transfer. The Kv
and in-memory backends ignore it (they return the full object). Use it when you
only need a subset of fields:

```ts
// changePassword only needs the password hash to verify
const user = await store.findById(id, ["password"]);
```

**When NOT to use `state.store`:**

- Your data doesn't fit the `UserStore` shape (not a user)
- You need SurrealQL features like live queries, `GROUP BY`, or joins
- You're doing DDL (CREATE TABLE, DEFINE INDEX)

For those, use `state.db.query()` directly.

---

## Pattern 2: Custom queries via `db.query()`

For custom tables and SurrealQL queries, get the `DatabaseConnection` through
`requireDb()` and run queries with parameter binding.

```ts
import { requireDb, withDb } from "@blenny/core/db-guard.ts";
import { unwrapFirst } from "@blenny/core/db-query.ts";
import type { DatabaseConnection } from "@blenny/core/db-connection.ts";

let db: DatabaseConnection;

const myModule: BlennyModule = {
  name: "events",
  initialize(state_: AppState) {
    db = requireDb(state_.db, "events");
  },
};
```

### Multiple rows

Always pass a typed generic to `query()` so the result is correctly shaped:

```ts
interface EventRow {
  id: string;
  name: string;
  status: string;
}

const result = await db.query<[EventRow[]]>(
  "SELECT * FROM event WHERE status = $status ORDER BY createdAt DESC",
  { status: "active" },
);
const events = result[0] ?? [];
```

### Single row

Append `LIMIT 1` and use `unwrapFirst()`:

```ts
const event = unwrapFirst(
  await db.query<[EventRow[]]>(
    "SELECT * FROM event WHERE id = $id LIMIT 1",
    { id: "abc" },
  ),
);
if (!event) return c.text("Not found", 404);
```

### INSERT / CREATE

```ts
await db.query(
  "CREATE event CONTENT $data",
  {
    data: {
      name: "Airsoft Op",
      status: "planned",
      createdBy: userId,
    },
  },
);
```

### UPDATE / MERGE

```ts
await db.query(
  "UPDATE event MERGE { status: $status } WHERE id = $id",
  { id: eventId, status: "cancelled" },
);
```

### DELETE

```ts
await db.query("DELETE event WHERE id = $id", { id: eventId });
```

### Graph traversal

SurrealQL can follow relationships across edges in a single query:

```ts
interface UserWithEvents {
  id: string;
  username: string;
  events: { name: string; status: string }[];
}

const result = await db.query<[UserWithEvents[]]>(
  "SELECT *, ->participates_in->event.* AS events FROM user WHERE id = $id",
  { id: userId },
);
```

### DDL (schema setup)

Run DDL during `initialize()`. It's idempotent when `IF NOT EXISTS` is used:

```ts
async initialize(state_: AppState) {
  const db = requireDb(state_.db, "events");

  await db.query("DEFINE TABLE IF NOT EXISTS event SCHEMAFULL");
  await db.query("DEFINE FIELD IF NOT EXISTS name ON event TYPE string");
  await db.query("DEFINE FIELD IF NOT EXISTS status ON event TYPE string");
  await db.query("DEFINE INDEX IF NOT EXISTS idx_event_status ON TABLE event COLUMNS status");
}
```

---

## Pattern 3: Scalar queries

For `RETURN` statements or aggregate functions that return a single value (not a
row set), use a scalar generic:

```ts
const [count] = await db.query<[number]>("RETURN count(SELECT * FROM event)");

const [exists] = await db.query<[boolean]>(
  "RETURN array::len((SELECT id FROM event WHERE id = $id)) > 0",
  { id: eventId },
);

const [hash] = await db.query<[string]>(
  "RETURN crypto::argon2::generate($password)",
  { password: rawPassword },
);
```

**Note:** Scalars are wrapped in a single-element outer array `[T]`, not
`[T[]]`. `unwrapFirst` is for `[T[]]` patterns only — for scalars, destructure
directly.

---

## Pattern 4: SurrealDB-specific features via `db.native()`

When you need the raw SurrealDB SDK — for file buckets or methods not exposed
through `query()` — use the `native()` escape hatch.

```ts
import { Surreal } from "@surrealdb/surrealdb";

const surreal = db.native<Surreal>();
```

### File bucket operations

SurrealDB's built-in file storage (`f'prefix:/id'`) already works through
`query()`, but the SDK also exposes `.put()` / `.get()` / `.delete()`:

```ts
// Via query() — preferred for most cases
await db.query(`f'avatars:/${userId}'.put($bytes)`, { bytes });

// Via native() — when you need typed SDK methods
const surreal = db.native<Surreal>();
```

### Live queries via `liveQuery()`

Use the `liveQuery()` helper to subscribe to real-time changes without touching
the Surreal SDK directly. It returns a `LiveSubscription` from the Surreal SDK —
a managed subscription that auto-restarts after reconnection.

```ts
import { liveQuery } from "@blenny/core/db-live.ts";
import type { LiveMessage, LiveSubscription } from "@blenny/core/db-live.ts";

let sub: LiveSubscription;

const myModule: BlennyModule = {
  name: "live-events",

  async initialize(state_: AppState) {
    const db = requireDb(state_.db, "live-events");

    sub = await liveQuery<EventRow>(db, "event", {
      where: "status = 'active'",
    });

    sub.subscribe((msg: LiveMessage) => {
      publish("event:update", { action: msg.action, data: msg.value });
    });
  },

  async stop() {
    await sub?.kill();
  },
};
```

**`LiveQueryOptions`:**

| Option   | Type       | Description                                      |
| -------- | ---------- | ------------------------------------------------ |
| `where`  | `string`   | SurrealQL condition (e.g. `"status = 'active'"`) |
| `fields` | `string[]` | Only return these fields on each change          |
| `diff`   | `boolean`  | Return patches (diffs) instead of full records   |

**`LiveMessage` shape:**

```ts
type LiveMessage = {
  queryId: Uuid; // The live subscription's ID
  action: "CREATE" | "UPDATE" | "DELETE";
  recordId: RecordId; // The SurrealDB record ID
  value: Record<string, unknown>; // The changed record data
};
```

**Receiving messages — two APIs:**

| API                            | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `sub.subscribe(fn)`            | Calls `fn` on every event, **returns an unsubscribe function** |
| `for await (const msg of sub)` | Async iteration, works with `break` to stop                    |

```ts
// Option A: subscribe / unsubscribe
const unsub = sub.subscribe((msg) => publish("event", msg));
// later: unsub(); — stop receiving events (doesn't kill the subscription)

// Option B: for-await
for await (const msg of sub) {
  if (msg.action === "DELETE") break; // kills the iterator, not the subscription
}
```

**Error note:** `liveQuery()` calls `db.native<Surreal>()` internally and will
**throw** if the database backend is not SurrealDB. This is intentional — live
queries are a SurrealDB-specific feature, not available on Kv or in-memory
backends.

**Lifecycle note:** Managed live subscriptions auto-restart after a
reconnection, so the subscription survives health-check reconnects without
re-issuing the query. Call `sub.kill()` during your module's `stop()` to tear it
down.

### Testing liveQuery

Unit tests in `tests/db-live_test.ts` cover the builder chain wiring, error
behavior, and unsubscribe semantics using mock Surreal objects — these run on
every `deno test` with no special flags.

An integration test is gated behind `BLENNY_SURREAL_URL`: it connects to a real
SurrealDB instance, subscribes, inserts a matching row, and asserts the event
fires. Run it with:

```sh
BLENNY_SURREAL_URL=ws://127.0.0.1:8000/rpc deno test --allow-env --filter="integration"
```

The integration test is silently ignored when the env var is unset or
`--allow-env` is not granted, so it never blocks the regular test suite.

---

## Pattern 5: Graceful fallback with `withDb()`

When a database query is non-critical (e.g. an optional feature), use `withDb()`
to avoid crashing if the DB is unavailable:

```ts
const result = await withDb(
  state_.db,
  (db) =>
    db.query<[string[]]>("SELECT name FROM feature_flags WHERE active = true"),
  [], // fallback — empty list if DB is down
);
```

The fallback is returned if:

- `db` is undefined (not configured)
- The query throws a non-`DbError` (e.g. network timeout)

---

## Result typing reference

| Query shape              | Generic                      | Extraction                               |
| ------------------------ | ---------------------------- | ---------------------------------------- |
| Rows                     | `<[RowType[]]>`              | `result[0] ?? []`                        |
| Single row               | `<[RowType[]]>`              | `unwrapFirst(result) ?? null`            |
| Scalar                   | `<[ScalarType]>`             | `const [value] = result`                 |
| INSERT / UPDATE / DELETE | omit (or `<[RecordType[]]>`) | `unwrapFirst(result)` to check existence |

`unwrapFirst` is defined as:

```ts
export function unwrapFirst<T>(result: [T[]]): T | undefined {
  return result?.[0]?.[0];
}
```

It safely handles empty result sets (`[[]]`) and returns `undefined`.

---

## Quick reference

```ts
// ── Guards ──
const db = requireDb(state_.db, "module-name"); // crash if missing
const result = await withDb(state_.db, fn, fallback); // graceful fallback

// ── Store (user CRUD, backend-agnostic) ──
const user = await store.findById(id, ["role"]); // projection
const users = await store.findAll();
const alice = await store.findByUsername("alice");
await store.createUser(data);
await store.updateRole(id, "admin");
await store.changePassword(id, current, newPassword);
await store.deleteUser(id);

// ── Custom queries (SurrealQL) ──
const rows = (await db.query<[Row[]]>("SELECT ...", { vars }))[0] ?? [];
const single = unwrapFirst(
  await db.query<[Row[]]>("SELECT ... LIMIT 1", { vars }),
);
const [scalar] = await db.query<[number]>("RETURN ...", { vars });
await db.query("CREATE ... CONTENT $data", { data });
await db.query("UPDATE ... MERGE ... WHERE ...", { vars });
await db.query("DELETE ... WHERE ...", { vars });

// ── Live queries (real-time subscriptions) ──
const sub = await liveQuery<Row>(db, "table", { where, fields, diff });
const unsub = sub.subscribe((msg) => /* { action, value, recordId } */);
for await (const msg of sub) { /* same shape */ }
await sub.kill(); // tear down in stop()

// ── SurrealDB-specific (escape hatch) ──
const surreal = db.native<Surreal>();
// File buckets, SDK builder APIs not exposed through query()
```
