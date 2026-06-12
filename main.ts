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
import { isServeMode } from "./src/core/worker-id.ts";
import { WorkerMailbox } from "./src/core/worker-mailbox.ts";
import { WorkerTransport } from "./src/core/worker-transport.ts";
import { LeaderElector } from "./src/core/leader-elector.ts";
import { publish } from "./src/core/hub.ts";

const config = loadConfig();
checkJwtSecret(config);

const { hub, state, app, supervisor } = await createServices(config);
await boot.setupDatabase(state, config);

configureMiddleware(app, config);
createErrorHandler(app);
createNotFoundHandler(app);

const { modules } = await boot.discoverModules(config);
boot.detectCapabilityConflicts(modules);
boot.detectMissingDependencies(modules);
state.moduleCount = modules.length;
await boot.initializeModules(modules, state);

boot.applyAuthMiddleware(app, state);
boot.registerModuleRoutes(app, modules, state);
boot.subscribeModuleEvents(modules);

await boot.startModules(modules, state);

registerPlatformEndpoints(app, state, config);

if (isServeMode()) {
  if (config.parallel) {
    const mailbox = new WorkerMailbox((item) => hub.handleMailboxMessage(item));
    const transport = new WorkerTransport(mailbox);
    hub.enableParallel(mailbox, transport);
    transport.onDrain = () => { hub.drain(); };
    if (config.parallelTasks) {
      const elector = new LeaderElector(transport);
      supervisor.setLeaderElector(elector);
      elector.start();
    }
  }

  hub.startReaper(config.idleTimeoutMs);
  supervisor.start();
  publish("platform:ready", { timestamp: Date.now() });
} else {
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
}

export default app.fetch;
