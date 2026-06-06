import { checkJwtSecret, loadConfig } from "./src/core/bootstrap/config.ts";
import { createServices } from "./src/core/bootstrap/services.ts";
import {
  configureMiddleware,
  createErrorHandler,
  createNotFoundHandler,
} from "./src/core/bootstrap/middlewares.ts";
import {
  applyAuthMiddleware,
  detectCapabilityConflicts,
  discoverModules,
  initializeModules,
  registerModuleRoutes,
  setupDatabase,
  startModules,
  stopModules,
  subscribeModuleEvents,
} from "./src/core/bootstrap/modules.ts";
import { registerPlatformEndpoints } from "./src/core/bootstrap/endpoints.ts";
import { startServer } from "./src/core/bootstrap/server.ts";
import { publish } from "./src/core/hub.ts";

// ─── Config ───
const config = loadConfig();
checkJwtSecret(config);

// ─── Services ───
const { hub, state, app } = await createServices(config);

// ─── Middleware ───
configureMiddleware(app, config);
createErrorHandler(app);
createNotFoundHandler(app);

// ─── Modules ───
const { modules } = await discoverModules(config);
detectCapabilityConflicts(modules);
await setupDatabase(state, config);
await initializeModules(modules, state);

// ─── Routing ───
applyAuthMiddleware(app, state);
registerModuleRoutes(app, modules, state);
subscribeModuleEvents(modules);
await startModules(modules, state);

// ─── Platform ───
registerPlatformEndpoints(app, state, config, modules.length);

// ─── Server ───
const { finished } = startServer(app, config, hub);
await finished;

// ─── Shutdown ───
await hub.drain(30_000);
await stopModules(modules, state);
publish("log", { level: "info", template: "blenny-ts shutdown complete" });
