import { assertEquals } from "@std/assert";
import { TaskSupervisor } from "@blenny/core/task-supervisor.ts";

Deno.test("TaskSupervisor", async (t) => {
  await t.step("fires on cadence", async () => {
    const sv = new TaskSupervisor();
    let count = 0;
    sv.add("tick", () => {
      count++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 35));
    await sv.stop();
    assertEquals(count >= 2, true);
  });

  await t.step("error isolation — task recovers", async () => {
    const sv = new TaskSupervisor();
    let count = 0;
    sv.add("bad", () => {
      count++;
      if (count === 1) throw new Error("first tick fails");
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 35));
    await sv.stop();
    assertEquals(count >= 2, true);
  });

  await t.step("stop halts execution", async () => {
    const sv = new TaskSupervisor();
    let count = 0;
    sv.add("tick", () => {
      count++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 20));
    await sv.stop();
    const snapshot = count;
    await new Promise((r) => setTimeout(r, 50));
    assertEquals(count, snapshot);
  });

  await t.step("idempotent start and stop", async () => {
    const sv = new TaskSupervisor();
    sv.start();
    sv.start();
    await sv.stop();
    await sv.stop();
  });

  await t.step("multiple tasks fire independently", async () => {
    const sv = new TaskSupervisor();
    let a = 0, b = 0;
    sv.add("a", () => {
      a++;
    }, 10);
    sv.add("b", () => {
      b++;
    }, 20);
    sv.start();
    await new Promise((r) => setTimeout(r, 35));
    await sv.stop();
    assertEquals(a >= 2, true);
    assertEquals(b >= 1, true);
  });

  await t.step("no overlapping execution for slow tasks", async () => {
    const sv = new TaskSupervisor();
    let concurrent = 0;
    let maxConcurrent = 0;
    sv.add("slow", async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 30));
      concurrent--;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 60));
    await sv.stop();
    assertEquals(maxConcurrent, 1);
  });

  await t.step("add after stop works", async () => {
    const sv = new TaskSupervisor();
    let count = 0;
    sv.add("tick", () => {
      count++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 20));
    await sv.stop();
    const before = count;
    sv.add("tick", () => {
      count++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 20));
    await sv.stop();
    assertEquals(count > before, true);
  });

  await t.step("backoff on failure", async () => {
    const sv = new TaskSupervisor(100);
    let count = 0;
    sv.add("fail", () => {
      count++;
      throw new Error("boom");
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 80));
    await sv.stop();
    assertEquals(count >= 1, true);
  });

  await t.step("failure count resets on start", async () => {
    const sv = new TaskSupervisor(50);
    let count = 0;
    sv.add("flap", () => {
      count++;
      throw new Error("fail");
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 30));
    await sv.stop();

    let count2 = 0;
    sv.add("flap", () => {
      count2++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 25));
    await sv.stop();
    assertEquals(count2 >= 2, true);
  });

  await t.step("getTask returns task info", async () => {
    const sv = new TaskSupervisor();
    sv.add("tick", () => {}, 100, 1000);
    sv.start();

    const info = sv.getTask("tick");
    assertEquals(info?.name, "tick");
    assertEquals(info?.intervalMs, 100);
    assertEquals(info?.maxBackoff, 1000);
    assertEquals(info?.failures, 0);
    assertEquals(info?.running, true);

    await sv.stop();
    const stopped = sv.getTask("tick");
    assertEquals(stopped?.running, false);
  });

  await t.step("getTask returns undefined for unknown task", () => {
    const sv = new TaskSupervisor();
    assertEquals(sv.getTask("nonexistent"), undefined);
  });

  await t.step("listTasks returns all tasks", async () => {
    const sv = new TaskSupervisor();
    sv.add("a", () => {}, 10);
    sv.add("b", () => {}, 20, 500);
    sv.start();

    const tasks = sv.listTasks();
    assertEquals(tasks.length, 2);
    assertEquals(tasks.find((t) => t.name === "a")?.intervalMs, 10);
    assertEquals(tasks.find((t) => t.name === "b")?.maxBackoff, 500);

    await sv.stop();
  });

  await t.step("replace swaps task without stopping others", async () => {
    const sv = new TaskSupervisor();
    let a = 0, b = 0;
    sv.add("a", () => {
      a++;
    }, 10);
    sv.add("b", () => {
      b++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 25));

    sv.replace("a", () => {
      a += 10;
    }, 10);
    await new Promise((r) => setTimeout(r, 25));
    await sv.stop();

    // a ran at least once with the new fn (increment by 10)
    assertEquals(a >= 10, true);
    // b still ran normally
    assertEquals(b >= 2, true);
  });

  await t.step("replace on stopped supervisor does not start", () => {
    const sv = new TaskSupervisor();
    let count = 0;
    sv.add("tick", () => {
      count++;
    }, 10);
    sv.replace("tick", () => {
      count += 10;
    }, 10);
    assertEquals(count, 0);
  });

  await t.step("onError callback is invoked on failure", async () => {
    const sv = new TaskSupervisor(100);
    const errors: { err: unknown; failures: number }[] = [];
    let callCount = 0;
    sv.add(
      "fail",
      () => {
        callCount++;
        throw new Error("boom");
      },
      10,
      100,
      {
        onError(err, failures) {
          errors.push({ err, failures });
        },
      },
    );
    sv.start();
    await new Promise((r) => setTimeout(r, 50));
    await sv.stop();

    assertEquals(callCount >= 1, true);
    assertEquals(errors.length >= 1, true);
    assertEquals(String(errors[0].err), "Error: boom");
    assertEquals(errors[0].failures, 1);
  });

  await t.step(
    "stop awaits in-flight tasks before resolving",
    async () => {
      const sv = new TaskSupervisor();
      let completed = false;
      sv.add("slow", async () => {
        await new Promise((r) => setTimeout(r, 30));
        completed = true;
      }, 10);
      sv.start();
      await new Promise((r) => setTimeout(r, 5));
      await sv.stop();
      assertEquals(completed, true);
    },
  );
});
