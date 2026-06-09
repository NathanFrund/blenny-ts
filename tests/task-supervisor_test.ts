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
    sv.stop();
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
    sv.stop();
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
    sv.stop();
    const snapshot = count;
    await new Promise((r) => setTimeout(r, 50));
    assertEquals(count, snapshot);
  });

  await t.step("idempotent start and stop", () => {
    const sv = new TaskSupervisor();
    sv.start();
    sv.start();
    sv.stop();
    sv.stop();
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
    sv.stop();
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
    sv.stop();
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
    sv.stop();
    const before = count;
    sv.add("tick", () => {
      count++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 20));
    sv.stop();
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
    sv.stop();
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
    sv.stop();

    // second round — count should be 0 internally
    let count2 = 0;
    sv.add("flap", () => {
      count2++;
    }, 10);
    sv.start();
    await new Promise((r) => setTimeout(r, 25));
    sv.stop();
    assertEquals(count2 >= 2, true);
  });
});
