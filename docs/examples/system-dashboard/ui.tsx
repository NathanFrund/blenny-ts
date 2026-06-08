import type { FC } from "@hono/hono/jsx";

const Dashboard: FC = () => (
  <div>
    <h1>System Dashboard</h1>
    <p style="color:#666">Updates every 5 seconds via Datastar SSE</p>
    <table style="text-align:left">
      <tr><td><strong>Hostname</strong></td><td data-text="$.sys.hostname">—</td></tr>
      <tr><td><strong>Memory Total</strong></td><td data-text="$.sys.memTotal">—</td></tr>
      <tr><td><strong>Memory Used</strong></td><td data-text="$.sys.memUsed">—</td></tr>
      <tr><td><strong>Memory Free</strong></td><td data-text="$.sys.memFree">—</td></tr>
      <tr><td><strong>Load Average</strong></td><td>
        <span data-text="$.sys.load1m">—</span> /
        <span data-text="$.sys.load5m">—</span> /
        <span data-text="$.sys.load15m">—</span>
      </td></tr>
      <tr><td><strong>Process Uptime</strong></td><td>
        <span data-text="$.sys.uptime">—</span> hours
      </td></tr>
      <tr><td><strong>Collected At</strong></td><td data-text="$.sys.collectedAt">—</td></tr>
    </table>
    <p><a href="/dashboard">Back to Dashboard</a></p>
  </div>
);

export default Dashboard;
