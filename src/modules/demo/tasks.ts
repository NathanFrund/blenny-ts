import type { TransportHub } from "@blenny/core/hub.ts";
import type { TaskSupervisor } from "@blenny/core/task-supervisor.ts";
import type { BlennyModule } from "@blenny/types";

const INTERVAL_MS = 2000;
const MAX_BACKOFF_MS = 30_000;
const MAX_LOG = 10;

let hub: TransportHub;
let supervisor: TaskSupervisor;
let failureCount = 0;
let attemptCount = 0;

interface LogEntry {
  attempt: number;
  time: string;
  status: "ok" | "fail";
  retryMs?: number;
}

const history: LogEntry[] = [];

function pushLog(entry: LogEntry): void {
  history.push(entry);
  if (history.length > MAX_LOG) history.shift();
}

function formatLog(): string {
  return history.map((e) => {
    const icon = e.status === "ok" ? " ✓" : " ✗";
    const idx = String(e.attempt).padStart(3);
    const retry = e.retryMs != null
      ? `  (next in ${(e.retryMs / 1000).toFixed(1)}s)`
      : "  (next in 2.0s)";
    return `${idx}${icon}  ${e.time}${retry}`;
  }).join("\n");
}

const taskDemoModule: BlennyModule = {
  name: "task-demo",
  routes: [
    {
      method: "GET",
      path: "/task-demo",
      handler: () => {
        return new Response(PAGE, {
          headers: { "Content-Type": "text/html" },
        });
      },
    },
  ],
  initialize(state) {
    hub = state.hub;
    supervisor = state.supervisor;
  },
  start() {
    supervisor.add(
      "flaky",
      () => {
        attemptCount++;
        const now = new Date().toLocaleTimeString();
        if (Math.random() < 0.65) {
          failureCount++;
          const retryMs = Math.min(
            INTERVAL_MS * Math.pow(2, failureCount),
            MAX_BACKOFF_MS,
          );
          pushLog({
            attempt: attemptCount,
            time: now,
            status: "fail",
            retryMs,
          });
          hub.mergeSignals({
            flakyStatus:
              `✗ FAILED at ${now} (attempt #${attemptCount}, retry #${failureCount} in ${
                (retryMs / 1000).toFixed(1)
              }s)`,
            flakyOk: false,
            flakyFail: true,
            flakyAttempts: attemptCount,
            flakyFailures: failureCount,
            flakyNextRetry: `${(retryMs / 1000).toFixed(1)}s`,
            flakyLog: formatLog(),
          });
          throw new Error(`Flaky service failed at ${now}`);
        }
        failureCount = 0;
        pushLog({
          attempt: attemptCount,
          time: now,
          status: "ok",
        });
        hub.mergeSignals({
          flakyStatus: `✓ OK at ${now} (attempt #${attemptCount})`,
          flakyOk: true,
          flakyFail: false,
          flakyAttempts: attemptCount,
          flakyFailures: 0,
          flakyNextRetry: `${(INTERVAL_MS / 1000).toFixed(1)}s`,
          flakyLog: formatLog(),
        });
      },
      INTERVAL_MS,
      MAX_BACKOFF_MS,
    );
  },
  stop() {
    supervisor.remove("flaky");
  },
};

const PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <title>Blenny — TaskSupervisor Demo</title>
    <script type="module" src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.1/bundles/datastar.js"></script>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; padding: 2rem; }
      h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
      p { color: #8b949e; font-size: 0.875rem; margin-bottom: 1.5rem; }
      .card { margin-bottom: 1rem; padding: 1rem; background: #161b22; border: 1px solid #30363d; border-radius: 6px; }
      .card h2 { font-size: 1rem; margin-bottom: 0.5rem; }
      .card p { font-size: 0.875rem; margin-bottom: 0.5rem; }
      .status { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem; font-weight: 600; }
      .status-ok { background: #3fb95022; color: #3fb950; border: 1px solid #3fb950; }
      .status-fail { background: #f8514922; color: #f85149; border: 1px solid #f85149; }
      .tag { display: inline-block; padding: 0.125rem 0.375rem; border-radius: 3px; font-size: 0.75rem; font-family: monospace; background: #21262d; color: #8b949e; border: 1px solid #30363d; }
      .meta { font-size: 0.75rem; color: #8b949e; margin-top: 0.5rem; }
      .meta span { margin-right: 1rem; }
      .log { font-family: ui-monospace, monospace; font-size: 0.8125rem; line-height: 1.6; white-space: pre; background: #0d1117; border: 1px solid #21262d; border-radius: 4px; padding: 0.75rem; color: #8b949e; min-height: 3.5rem; overflow-x: auto; }
      ul { font-size: 0.8125rem; color: #8b949e; padding-left: 1.25rem; }
      ul li { margin-bottom: 0.25rem; }
    </style>
  </head>
  <body>
    <h1>TaskSupervisor Demo</h1>
    <p>Demonstrates exponential backoff and failure recovery using <code class="tag">TaskSupervisor</code>.</p>

    <div class="card">
      <h2>Flaky Service</h2>
      <p data-init="@get('/sse?intent=data')" data-signals='{"flakyStatus":"waiting...","flakyOk":true,"flakyFail":false,"flakyAttempts":0,"flakyFailures":0,"flakyNextRetry":"2.0s","flakyLog":""}'>
        Status:
        <span data-show="$flakyOk" class="status status-ok" data-text="$flakyStatus"></span>
        <span data-show="$flakyFail" class="status status-fail" data-text="$flakyStatus"></span>
      </p>
      <div class="meta">
        <span>Attempts: <strong data-text="$flakyAttempts">0</strong></span>
        <span>Consecutive failures: <strong data-text="$flakyFailures">0</strong></span>
        <span>Next retry in: <strong data-text="$flakyNextRetry">2.0s</strong></span>
      </div>
      <p style="font-size:0.75rem;color:#8b949e">
        Fails ~65% of the time so you can see the backoff stack up. On failure the supervisor backs off
        exponentially (2s → 4s → 8s → … capped at 30s) and logs the error.
        Once healthy, it recovers immediately.
      </p>
    </div>

    <div class="card">
      <h2>Run Log</h2>
      <div class="log" data-text="$flakyLog"></div>
    </div>

    <div class="card">
      <h2>How it works</h2>
      <ul>
        <li>Adds a named task via <code class="tag">supervisor.add("flaky", fn, 2000, 30000)</code></li>
        <li>On success: failure counter resets, next run in 2s</li>
        <li>On error: counter increments, delay doubles (up to 30s)</li>
        <li>On shutdown: <code class="tag">supervisor.remove("flaky")</code> in <code class="tag">stop()</code></li>
        <li>Run log shows the last 10 attempts with status and next-retry timing</li>
      </ul>
    </div>
  </body>
</html>`;

export default taskDemoModule;
