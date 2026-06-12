import { assertEquals } from "@std/assert";
import { LeaderElector } from "../src/core/leader-elector.ts";
import { WorkerMailbox } from "../src/core/worker-mailbox.ts";
import { WorkerTransport, type MessageChannel } from "../src/core/worker-transport.ts";

function mockTransport(): {
  transport: WorkerTransport;
  mailbox: WorkerMailbox;
  channel: MessageChannel;
} {
  let onMsg: ((e: MessageEvent) => void) | null = null;
  const channel: MessageChannel = {
    postMessage() {},
    get onmessage() { return onMsg; },
    set onmessage(cb) { onMsg = cb; },
    close() {},
  };
  const mailbox = new WorkerMailbox(() => {});
  const transport = new WorkerTransport(mailbox, channel);
  return { transport, mailbox, channel };
}

Deno.test("LeaderElector", async (t) => {
  await t.step("single worker becomes leader", () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 120000,
    });
    elector.start();
    try {
      assertEquals(elector.isLeader(), true);
      assertEquals(elector.getLeader(), transport.workerId);
    } finally {
      elector.stop();
    }
  });

  await t.step("heartbeat from higher-ID worker does not change leader", () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 120000,
    });
    elector.start();
    try {
      assertEquals(elector.isLeader(), true);

      // Simulate heartbeat from a worker with higher ID (lexicographically)
      transport.onHeartbeat?.("ffffffff-ffff-ffff-ffff-ffffffffffff");

      assertEquals(elector.isLeader(), true);
      assertEquals(elector.getLeader(), transport.workerId);
    } finally {
      elector.stop();
    }
  });

  await t.step("heartbeat from lower-ID worker transfers leadership", () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 120000,
    });
    elector.start();

    let electedLeader: string | null = null;
    elector.onElect = (id) => { electedLeader = id; };

    try {
      const lowerId = "00000000-0000-0000-0000-000000000001";
      transport.onHeartbeat?.(lowerId);

      assertEquals(elector.isLeader(), false);
      assertEquals(elector.getLeader(), lowerId);
      assertEquals(electedLeader, lowerId);
    } finally {
      elector.stop();
    }
  });

  await t.step("onElect fires once per leadership change", () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 120000,
    });
    elector.start();

    const changes: string[] = [];
    elector.onElect = (id) => { changes.push(id); };

    try {
      transport.onHeartbeat?.("00000000-0000-0000-0000-000000000001");
      assertEquals(changes.length, 1);

      transport.onHeartbeat?.("00000000-0000-0000-0000-000000000000");
      assertEquals(changes.length, 2);

      transport.onHeartbeat?.("00000000-0000-0000-0000-000000000000");
      assertEquals(changes.length, 2);
    } finally {
      elector.stop();
    }
  });

  await t.step("dead worker causes re-election", async () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 50,
    });
    elector.start();

    const changes: string[] = [];
    elector.onElect = (id) => { changes.push(id); };

    transport.onHeartbeat?.("00000000-0000-0000-0000-000000000001");
    assertEquals(elector.isLeader(), false);
    assertEquals(changes.length, 1);

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        elector.check();
        assertEquals(elector.isLeader(), true);
        assertEquals(elector.getLeader(), transport.workerId);
        assertEquals(changes.length, 2);
        elector.stop();
        resolve();
      }, 60);
    });
  });

  await t.step("stop clears timer and halts tick", async () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 10,
      deadTimeout: 10000,
    });

    const heartbeats: string[] = [];
    transport.sendHeartbeat = () => { heartbeats.push("sent"); };

    elector.start();
    elector.stop();

    const before = heartbeats.length;
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        assertEquals(heartbeats.length, before);
        resolve();
      }, 30);
    });
  });

  await t.step("getActiveWorkers returns only alive workers", async () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 100,
    });
    elector.start();

    transport.onHeartbeat?.("ffffffff-ffff-ffff-ffff-ffffffffffff");
    assertEquals(elector.getActiveWorkers().length, 2);

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        elector.check();
        const active = elector.getActiveWorkers();
        assertEquals(active.length, 1);
        assertEquals(active[0], transport.workerId);
        elector.stop();
        resolve();
      }, 110);
    });
  });

  await t.step("heartbeats before start are ignored", () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 120000,
    });

    transport.onHeartbeat?.("00000000-0000-0000-0000-000000000001");

    elector.start();
    try {
      // Should still be leader (the pre-start heartbeat was ignored)
      assertEquals(elector.isLeader(), true);
    } finally {
      elector.stop();
    }
  });

  await t.step("heartbeats after stop are ignored", () => {
    const { transport } = mockTransport();
    const elector = new LeaderElector(transport, {
      heartbeatInterval: 60000,
      deadTimeout: 120000,
    });

    elector.start();
    elector.stop();

    transport.onHeartbeat?.("00000000-0000-0000-0000-000000000001");
    // Still ourselves
    assertEquals(elector.isLeader(), false);
  });
});
