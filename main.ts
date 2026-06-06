import { checkJwtSecret, loadConfig } from "./src/core/bootstrap/config.ts";
import { createServices } from "./src/core/bootstrap/services.ts";
import {
  configureMiddleware,
  createErrorHandler,
  createNotFoundHandler,
} from "./src/core/bootstrap/middlewares.ts";
import * as boot from "./src/core/bootstrap/modules.ts";
import { registerPlatformEndpoints } from "./src/core/bootstrap/endpoints.ts";
import { startServer } from "./src/core/bootstrap/server.ts";
import { publish } from "./src/core/hub.ts";

// ─── Config ───
const config = loadConfig();
checkJwtSecret(config);

// ─── Services ───
const { hub, state, app } = await createServices(config);
await boot.setupDatabase(state, config);

// ─── Middleware ───
configureMiddleware(app, config);
createErrorHandler(app);
createNotFoundHandler(app);

// ─── Modules ───
const { modules } = await boot.discoverModules(config);
boot.detectCapabilityConflicts(modules);
state.moduleCount = modules.length;
await boot.initializeModules(modules, state);

// ─── Routing ───
boot.applyAuthMiddleware(app, state);
boot.registerModuleRoutes(app, modules, state);
boot.subscribeModuleEvents(modules);

// ─── Lifecycle ───
await boot.startModules(modules, state);

// ─── Platform ───
registerPlatformEndpoints(app, state, config);

// ─── Server ───
const abortController = new AbortController();
let shuttingDown = false;

Deno.addSignalListener("SIGINT", () => {
  if (shuttingDown) Deno.exit(1);
  shuttingDown = true;
  abortController.abort();
});
Deno.addSignalListener("SIGTERM", () => {
  if (shuttingDown) Deno.exit(1);
  shuttingDown = true;
  abortController.abort();
});

try {
  const { finished } = startServer(app, config, hub, abortController.signal);
  await finished;
} catch (err) {
  publish("log", {
    level: "error",
    template: "Server error: {error}",
    args: { error: String(err) },
  });
} finally {
  shuttingDown = true;
  publish("log", { level: "info", template: "Shutting down…" });
  await hub.drain(30_000);
  publish("log", { level: "info", template: "Drain complete" });
  await boot.stopModules(modules, state);
  publish("log", { level: "info", template: "Modules stopped" });
}
