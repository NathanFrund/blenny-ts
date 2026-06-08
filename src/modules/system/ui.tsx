import type { FC } from "@hono/hono/jsx";
import type { SystemMetrics } from "./state.ts";

const bytes = (n: number) => {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${units[i]}`;
};

const Dashboard: FC<{ metrics: SystemMetrics }> = ({ metrics }) => (
  <div>
    <h1>System Dashboard</h1>
    <table>
      <tr><td><strong>Hostname</strong></td><td>{metrics.hostname}</td></tr>
      <tr><td><strong>Memory Total</strong></td><td>{bytes(metrics.memory.total)}</td></tr>
      <tr><td><strong>Memory Used</strong></td><td>{bytes(metrics.memory.used)}</td></tr>
      <tr><td><strong>Memory Free</strong></td><td>{bytes(metrics.memory.free)}</td></tr>
      <tr><td><strong>Load Average</strong></td><td>{metrics.loadAvg.map((n) => n.toFixed(2)).join(", ")}</td></tr>
      <tr><td><strong>Process Uptime</strong></td><td>{((Date.now() - metrics.startTime) / 3600000).toFixed(1)} hours</td></tr>
      <tr><td><strong>Collected At</strong></td><td>{metrics.collectedAt}</td></tr>
    </table>
    <p><a href="/dashboard">Back to Dashboard</a></p>
  </div>
);

export default Dashboard;
