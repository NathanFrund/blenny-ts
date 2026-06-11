import { publish } from "./hub.ts";

export type TaskFn = () => void | Promise<void>;

export interface TaskOptions {
  onError?: (err: unknown, failures: number) => void;
}

export interface TaskInfo {
  name: string;
  intervalMs: number;
  maxBackoff: number;
  failures: number;
  running: boolean;
}

interface TaskConfig {
  fn: TaskFn;
  intervalMs: number;
  maxBackoff: number;
  failures: number;
  onError?: (err: unknown, failures: number) => void;
}

function jitter(delay: number): number {
  const spread = delay * 0.25;
  return delay + (Math.random() * spread * 2 - spread);
}

function computeDelay(task: TaskConfig): number {
  if (task.failures === 0) return task.intervalMs;
  const base = Math.min(
    task.intervalMs * Math.pow(2, task.failures),
    task.maxBackoff,
  );
  return jitter(base);
}

export class TaskSupervisor {
  private tasks = new Map<string, TaskConfig>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = new Map<string, Promise<void>>();
  private isRunning = false;

  constructor(
    private defaultMaxBackoff = 60_000,
  ) {}

  add(
    name: string,
    fn: TaskFn,
    intervalMs: number,
    maxBackoff?: number,
    options?: TaskOptions,
  ): void {
    this.tasks.set(name, {
      fn,
      intervalMs,
      maxBackoff: maxBackoff ?? this.defaultMaxBackoff,
      failures: 0,
      onError: options?.onError,
    });
  }

  replace(
    name: string,
    fn: TaskFn,
    intervalMs: number,
    maxBackoff?: number,
    options?: TaskOptions,
  ): void {
    this.stopTask(name);
    this.tasks.set(name, {
      fn,
      intervalMs,
      maxBackoff: maxBackoff ?? this.defaultMaxBackoff,
      failures: 0,
      onError: options?.onError,
    });
    if (this.isRunning) {
      this.startTask(name);
    }
  }

  remove(name: string): void {
    this.stopTask(name);
    this.tasks.delete(name);
  }

  getTask(name: string): TaskInfo | undefined {
    const task = this.tasks.get(name);
    if (!task) return undefined;
    return {
      name,
      intervalMs: task.intervalMs,
      maxBackoff: task.maxBackoff,
      failures: task.failures,
      running: this.running.has(name) || this.timers.has(name),
    };
  }

  listTasks(): TaskInfo[] {
    return Array.from(this.tasks.keys()).map((name) => this.getTask(name)!);
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

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    for (const name of this.timers.keys()) {
      this.stopTask(name);
    }
    const inflight = Array.from(this.running.values());
    if (inflight.length > 0) {
      await Promise.allSettled(inflight);
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
        task.onError?.(err, task.failures);
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
        const delay = computeDelay(task);
        this.timers.set(name, setTimeout(run, delay));
      }
    };

    const promise = run();
    this.running.set(name, promise);
    promise.finally(() => {
      if (this.running.get(name) === promise) {
        this.running.delete(name);
      }
    });
  }

  private stopTask(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(name);
    }
  }
}
