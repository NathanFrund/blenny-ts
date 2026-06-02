import { loadConfig, checkJwtSecret } from "./src/core/bootstrap/config.ts";
import { createServices } from "./src/core/bootstrap/services.ts";
import {
  configureMiddleware,
  createErrorHandler,
  createNotFoundHandler,
} from "./src/core/bootstrap/middlewares.ts";
import {
  discoverModules,
  detectCapabilityConflicts,
  setupDatabase,
  initializeModules,
  applyAuthMiddleware,
  registerModuleRoutes,
  subscribeModuleEvents,
  startModules,
  stopModules,
} from "./src/core/bootstrap/modules.ts";
import { registerPlatformEndpoints } from "./src/core/bootstrap/endpoints.ts";
import { startServer } from "./src/core/bootstrap/server.ts";

const config = loadConfig();
checkJwtSecret(config);
const { hub, conduit: _conduit, logger, state, app } = await createServices(config);
configureMiddleware(app, config, logger);
createErrorHandler(app, logger);
createNotFoundHandler(app);
const { modules, failures: _failures } = await discoverModules(logger, config);
detectCapabilityConflicts(modules);
await setupDatabase(state, config, logger);
await initializeModules(modules, state, logger);
applyAuthMiddleware(app, state);
registerModuleRoutes(app, modules, state, logger);
subscribeModuleEvents(modules, logger);
await startModules(modules, logger);
registerPlatformEndpoints(app, state, config, modules.length);
const { finished } = startServer(app, config, hub, logger);
await finished;
await stopModules(modules, state, logger);
logger.info("blenny-ts shutdown complete");
