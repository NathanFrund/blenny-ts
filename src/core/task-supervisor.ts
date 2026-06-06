import { publish } from "./hub.ts";

type TaskFn = () => void | Promise<void>;

interface TaskConfig {
  fn: TaskFn;
  intervalMs: number;
  maxBackoff: number;
  failures: number;
}

/**
 * Manages named recurring tasks using chained setTimeout.
 *
 * Each task's next run is scheduled after the previous run completes
 * (including any await). This means the gap between executions is
 * `fn_duration + intervalMs`, not a fixed cadence — suitable for
 * heartbeats, reapers, and cache refreshes, but not metronomes.
 *
 * The first `run()` of each task fires synchronously during `start()`.
 * To hot-swap a running task: `stop()` → `add()` → `start()`.
 * Failure count resets on `start()`.
 */
export class TaskSupervisor {
  private tasks = new Map<string, TaskConfig>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private isRunning = false;

  constructor(
    private defaultMaxBackoff = 60_000,
  ) {}

  add(
    name: string,
    fn: TaskFn,
    intervalMs: number,
    maxBackoff?: number,
  ): void {
    this.tasks.set(name, {
      fn,
      intervalMs,
      maxBackoff: maxBackoff ?? this.defaultMaxBackoff,
      failures: 0,
    });
  }

  remove(name: string): void {
    this.stopTask(name);
    this.tasks.delete(name);
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    for (const entry of this.tasks.values()) {
      entry.failures = 0;
    }
    for (const [name] of this.tasks) {
      this.startTask(name);
    }
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    for (const name of this.timers.keys()) {
      this.stopTask(name);
    }
  }

  private startTask(name: string): void {
    const task = this.tasks.get(name);
    if (!task) return;

    const run = async () => {
      let reschedule = true;
      try {
        await task.fn();
        task.failures = 0;
      } catch (err) {
        task.failures++;
        publish("log", {
          level: "warn",
          template: `Task "${name}" failed ({failures}x)`,
          args: { failures: task.failures, error: String(err) },
        });
      }
      if (!this.isRunning || !this.tasks.has(name)) {
        reschedule = false;
      }
      if (reschedule) {
        const delay = task.failures === 0 ? task.intervalMs : Math.min(
          task.intervalMs * Math.pow(2, task.failures),
          task.maxBackoff,
        );
        this.timers.set(name, setTimeout(run, delay));
      }
    };

    run();
  }

  private stopTask(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(name);
    }
  }
}
