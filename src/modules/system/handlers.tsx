import type { Context } from "@hono/hono";
import { state } from "./state.ts";
import Dashboard from "./ui.tsx";

export function handleDashboard(c: Context): Response | Promise<Response> {
  if (!state.metrics) {
    return c.text("Metrics not yet available — refresh in a moment", 503);
  }
  return state.conduit.respond(c, <Dashboard metrics={state.metrics} />);
}
