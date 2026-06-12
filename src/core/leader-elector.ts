import type { WorkerTransport } from "./worker-transport.ts";
import { getWorkerId } from "./worker-id.ts";

export interface LeadElectorOptions {
  heartbeatInterval?: number;
  deadTimeout?: number;
}

export class LeaderElector {
  private workers = new Map<string, number>();
  private leaderId: string | null = null;
  private myWorkerId: string;
  private heartbeatInterval: number;
  private deadTimeout: number;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private alive = false;

  onElect: ((leaderId: string) => void) | null = null;

  constructor(
    private transport: WorkerTransport,
    opts?: LeadElectorOptions,
  ) {
    this.myWorkerId = getWorkerId();
    this.heartbeatInterval = opts?.heartbeatInterval ?? 1000;
    this.deadTimeout = opts?.deadTimeout ?? 3000;
    this.transport.onHeartbeat = (workerId) => {
      if (!this.alive) return;
      this.recordHeartbeat(workerId);
    };
  }

  start(): void {
    if (this.alive) return;
    this.alive = true;
    this.workers.set(this.myWorkerId, Date.now());
    this.transport.sendHeartbeat();
    this.electLeader();
    this.scheduleTick();
  }

  stop(): void {
    this.alive = false;
    this.leaderId = null;
    this.workers.clear();
    if (this.tickTimer !== null) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  isLeader(): boolean {
    return this.leaderId === this.myWorkerId;
  }

  getLeader(): string | null {
    return this.leaderId;
  }

  getActiveWorkers(): string[] {
    const now = Date.now();
    const active: string[] = [];
    for (const [id, ts] of this.workers) {
      if (now - ts < this.deadTimeout) {
        active.push(id);
      }
    }
    return active;
  }

  check(): void {
    this.electLeader();
  }

  private recordHeartbeat(workerId: string): void {
    this.workers.set(workerId, Date.now());
    this.electLeader();
  }

  private electLeader(): void {
    if (!this.alive) return;

    const now = Date.now();
    this.workers.set(this.myWorkerId, now);

    const active: string[] = [];
    for (const [id, ts] of this.workers) {
      if (now - ts < this.deadTimeout) {
        active.push(id);
      }
    }

    if (active.length === 0) {
      active.push(this.myWorkerId);
    }

    active.sort();
    const newLeader = active[0];

    if (newLeader !== this.leaderId) {
      this.leaderId = newLeader;
      this.onElect?.(newLeader);
    }
  }

  private tick(): void {
    if (!this.alive) return;
    this.transport.sendHeartbeat();
    this.workers.set(this.myWorkerId, Date.now());
    this.electLeader();
    this.scheduleTick();
  }

  private scheduleTick(): void {
    this.tickTimer = setTimeout(() => this.tick(), this.heartbeatInterval);
  }
}
