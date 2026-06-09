import type { Context } from "@hono/hono";
import Dashboard from "./ui.tsx";

export function handleDashboard(c: Context): Response {
  return c.html(
    <html>
      <head>
        <title>System Dashboard</title>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script
          type="module"
          src="https://cdn.jsdelivr.net/gh/starfederation/datastar@v1.0.1/bundles/datastar.js"
        >
        </script>
      </head>
      <body>
        <div
          data-init="@get('/sse?intent=data')"
          data-signals='{"sys":{"hostname":"","memTotal":0,"memUsed":0,"memFree":0,"load1m":0,"load5m":0,"load15m":0,"uptime":0,"collectedAt":""}}'
        >
          <Dashboard />
        </div>
      </body>
    </html>,
  );
}
