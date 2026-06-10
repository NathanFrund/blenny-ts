import { assertEquals, assertThrows } from "@std/assert";
import type { DatabaseConnection } from "@blenny/core/db-connection.ts";
import { liveQuery } from "@blenny/core/db-live.ts";
import type { LiveMessage, LiveSubscription } from "@blenny/core/db-live.ts";
import type { Uuid } from "@surrealdb/surrealdb";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeDb(nativeFn: () => unknown): DatabaseConnection {
  return {
    connected: true,
    connect: () => Promise.resolve(),
    close: () => Promise.resolve(),
    query: <T>() => Promise.resolve([] as unknown as T),
    native: nativeFn as <T>() => T,
  };
}

function mockSub(): LiveSubscription {
  return {
    kill: () => Promise.resolve(),
    subscribe: () => () => {},
    [Symbol.asyncIterator](): AsyncIterator<LiveMessage> {
      return {
        next: () =>
          Promise.resolve({
            done: true,
            value: undefined as unknown as LiveMessage,
          }),
      };
    },
    get id() {
      return "mock-id" as unknown as Uuid;
    },
    get isManaged() {
      return true;
    },
    get resource() {
      return undefined;
    },
    get isAlive() {
      return true;
    },
  };
}

/** Create a thenable chain that records calls and resolves to mockSub. */
function mockChain(
  calls: string[],
  record: (args: Record<string, unknown>) => void,
) {
  const sub = mockSub();
  const chain = Promise.resolve(sub) as
    & Promise<LiveSubscription>
    & Record<string, unknown>;
  chain.where = (cond: string) => {
    calls.push("where");
    record({ where: cond });
    return chain;
  };
  chain.fields = (...fs: string[]) => {
    calls.push("fields");
    record({ fields: fs });
    return chain;
  };
  chain.diff = () => {
    calls.push("diff");
    record({ diff: true });
    return chain;
  };
  return chain;
}

// ─── Unit tests (always run, mock-based) ────────────────────────────────────

Deno.test("liveQuery throws when backend is not SurrealDB", () => {
  const db = makeDb(() => ({})); // no .live() method
  assertThrows(() => liveQuery(db, "event"));
});

Deno.test("liveQuery passes options to Surreal builder chain", async () => {
  const calls: string[] = [];
  const recorded: Record<string, unknown>[] = [];

  let liveTable = "";
  const mockSurreal = {
    live: (table: { toString(): string }) => {
      liveTable = String(table);
      return mockChain(calls, (args) => recorded.push(args));
    },
  };

  const db = makeDb(<T>() => mockSurreal as T);
  const sub = await liveQuery(db, "event", {
    where: "status = 'active'",
    fields: ["id", "name"],
    diff: true,
  });

  assertEquals(liveTable, "event");
  assertEquals(calls, ["where", "fields", "diff"]);
  assertEquals(typeof (recorded[0] as Record<string, unknown>).where, "object"); // Expr from raw()
  assertEquals(recorded[1], { fields: ["id", "name"] });
  assertEquals(recorded[2], { diff: true });
  assertEquals(typeof sub.kill, "function");
  assertEquals(typeof sub.subscribe, "function");
});

Deno.test("liveQuery without options still returns LiveSubscription", async () => {
  const mockSurreal = { live: () => Promise.resolve(mockSub()) };
  const db = makeDb(<T>() => mockSurreal as T);
  const sub = await liveQuery(db, "event");
  assertEquals(typeof sub.kill, "function");
  assertEquals(typeof sub.subscribe, "function");
});

Deno.test("liveQuery subscribe returns an unsubscribe function", async () => {
  let unsubscribed = false;
  const customSub: LiveSubscription = {
    kill: () => Promise.resolve(),
    subscribe: () => {
      unsubscribed = true;
      return () => {
        unsubscribed = false;
      };
    },
    [Symbol.asyncIterator](): AsyncIterator<LiveMessage> {
      return {
        next: () =>
          Promise.resolve({
            done: true,
            value: undefined as unknown as LiveMessage,
          }),
      };
    },
    get id() {
      return "mock-id" as unknown as Uuid;
    },
    get isManaged() {
      return true;
    },
    get resource() {
      return undefined;
    },
    get isAlive() {
      return true;
    },
  };
  const mockSurreal = { live: () => Promise.resolve(customSub) };
  const db = makeDb(<T>() => mockSurreal as T);
  const sub = await liveQuery(db, "event");
  const unsub = sub.subscribe(() => {});
  assertEquals(typeof unsub, "function");
  unsub();
  assertEquals(unsubscribed, false);
});

// ─── Integration test (gated: requires BLENNY_SURREAL_URL + --allow-env) ───

function surrealdbUrl(): string | null {
  try {
    return Deno.env.get("BLENNY_SURREAL_URL") ?? null;
  } catch {
    return null;
  }
}

const runIntegration = surrealdbUrl() !== null;

Deno.test({
  name:
    "liveQuery integration — insert fires subscription [requires SurrealDB]",
  ignore: !runIntegration,
  async fn() {
    const { Surreal } = await import("@surrealdb/surrealdb");

    const url = surrealdbUrl()!;
    const user = Deno.env.get("BLENNY_SURREAL_USER") ?? "root";
    const pass = Deno.env.get("BLENNY_SURREAL_PASS") ?? "root";

    const direct = new Surreal();
    await direct.connect(url, {
      authentication: { username: user, password: pass },
    });
    await direct.use({ namespace: "blenny_test", database: "blenny_test" });

    const table = `live_test_${Date.now()}`;
    await direct.query(`DEFINE TABLE IF NOT EXISTS ${table} SCHEMAFULL`);
    await direct.query(
      `DEFINE FIELD IF NOT EXISTS name ON ${table} TYPE string`,
    );
    await direct.query(
      `DEFINE FIELD IF NOT EXISTS status ON ${table} TYPE string`,
    );

    // Mock DatabaseConnection that delegates native() to the real Surreal
    const db = makeDb(<T>() => direct as T);
    const sub = await liveQuery(db, table, { where: "status = 'active'" });

    const event = new Promise<LiveMessage>((resolve) => {
      sub.subscribe(resolve);
    });

    await direct.query(`CREATE ${table} CONTENT $data`, {
      data: { name: "test", status: "active" },
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("timed out waiting for live event")),
        5000,
      )
    );
    const msg = await Promise.race([event, timeout]);

    assertEquals(msg.action, "CREATE");
    assertEquals(typeof msg.value, "object");

    await sub.kill();
    await direct.query(`DELETE ${table}`);
    direct.close();
  },
});
