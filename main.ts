import { Hono } from "@hono/hono";
import type { MiddlewareHandler } from "@hono/hono";
import { cors } from "@hono/hono/cors";
import { serveStatic } from "@hono/hono/deno";
import { BlennyConfig } from "./src/core/config.ts";
import { BlennyError, errorResponse } from "./src/core/error.ts";
import { connectDatabase } from "./src/core/database.ts";
import { BlennyPublisher } from "./src/core/publisher.ts";
import { publish, subscribe, TransportHub } from "./src/core/hub.ts";
import { Conduit } from "./src/core/conduit.ts";
import { getUser } from "./src/core/auth.ts";
import type { Intent } from "./src/core/envelope.ts";
import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";
import { SseConnection } from "./src/core/sse-connection.ts";
import { createWsHandler } from "./src/core/ws.ts";
import { loadModules } from "./src/core/module-loader.ts";
import type { AppState } from "./src/core/app-state.ts";
import type { BlennyEvents, HttpMethod } from "./src/types.ts";
import { createLogger, requestLogger } from "./src/core/logger.ts";

const config = new BlennyConfig();
config.logSources();

if (config.jwtSecret === "CHANGE-ME-EMBEDDED-DEFAULT" && !config.devMode) {
  console.error(
    "FATAL: auth.jwt_secret is still the embedded default. " +
    "Set BLENNY_AUTH_JWT_SECRET or add it to blenny.json before deploying to production.",
  );
  Deno.exit(1);
}

const hub = new TransportHub({
  maxConns: config.maxConnections,
  maxConnsPerUser: config.maxConnectionsPerUser,
});
BlennyPublisher.init(hub);
const conduit = new Conduit();
const logger = await createLogger(config);
const state: AppState = { hub, conduit, config, logger };
const app = new Hono();
app.use(requestLogger(logger));
app.use(cors());
app.use(async (c, next) => {
  const cl = c.req.header("content-length");
  if (cl) {
    const bytes = parseInt(cl, 10);
    if (bytes > config.maxBodyBytes) {
      return c.json(
        { error: { type: "request_too_large", message: "Request body too large" } },
        413,
      );
    }
  }
  await next();
});

app.onError((err, _c) => {
  if (err instanceof BlennyError) {
    return errorResponse(err.toJSON(), err.statusCode);
  }
  logger.error("Uncaught error: {error}", { error: err.message, stack: err.stack });
  return errorResponse(
    { error: { type: "internal", message: "Internal Server Error" } },
    500,
  );
});

app.notFound((_c) => {
  return errorResponse(
    { error: { type: "not_found", message: "Not Found" } },
    404,
  );
});

const { modules, failures } = await loadModules();
for (const mod of modules) {
  logger.info("Module loaded: {name}", { name: mod.name });
}
if (config.devMode) {
  for (const f of failures) {
    logger.error("Module load failure: {file} — {error}", { file: f.file, error: f.error, stack: f.stack });
  }
} else {
  for (const f of failures) {
    logger.warn("Module load failure: {file}", { file: f.file });
  }
}

// 1. Initialize — inject dependencies
for (const mod of modules) {
  await mod.initialize?.(state);
  logger.info("Module initialized: {name}", { name: mod.name });
}

// 2a. Apply auth middleware globally if an auth module was initialized
if (state.auth) {
  app.use("*", state.auth.middleware);
}

// 3. Register routes
for (const mod of modules) {
  for (const route of mod.routes) {
    const method = route.method as HttpMethod;
    const handler = route.handler as unknown as MiddlewareHandler;
    if (route.auth && state.auth) {
      const guard: MiddlewareHandler =
        typeof route.auth === "string"
          ? state.auth.requireRole(route.auth)
          : state.auth.requireUser;
      app.on(method, route.path, guard, handler);
    } else {
      app.on(method, route.path, handler);
    }
    logger.debug("Route registered: {method} {path} -> {module}", {
      method: route.method,
      path: route.path,
      module: mod.name,
    });
  }
}

// 4. Subscribe to typed events
for (const mod of modules) {
  if (mod.subscriptions) {
    for (const sub of mod.subscriptions) {
      subscribe(sub.topic as keyof BlennyEvents, sub.handler as (payload: unknown) => void);
      logger.debug("Event subscription: {module} -> {topic}", {
        module: mod.name,
        topic: sub.topic,
      });
    }
  }
}

// 4a. Connect database
state.db = (await connectDatabase(config)) ?? undefined;

// 5. Start — background tasks
for (const mod of modules) {
  await mod.start?.();
  if (mod.start) logger.info("Module started: {name}", { name: mod.name });
}

// ── Platform endpoints ──────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok", modules: modules.length }));

app.get("/sse", async (c) => {
  const intentParam = c.req.query("intent");
  const intents = intentParam
    ? new Set(intentParam.split(",") as Intent[])
    : undefined;

  let userId: string | undefined;
  if (state.auth) {
    const user = await getUser(c, state.auth.config);
    if (user) userId = user.id;
  }

  if (state.auth && config.transportAuthRequired && !userId) {
    return c.text("Unauthorized", 401);
  }

  return ServerSentEventGenerator.stream(
    (stream) => {
      if (c.req.raw.signal.aborted) return;

      const id = crypto.randomUUID();
      const conn = new SseConnection(stream, id, userId, intents);
      const cleanup = hub.registerConnection(conn);

      return new Promise<void>((resolve) => {
        c.req.raw.signal.addEventListener("abort", () => {
          cleanup();
          resolve();
        });
      });
    },
    { keepalive: true },
  );
});

const wsHandler = createWsHandler(hub);
app.get("/ws", async (c, next) => {
  if (state.auth && config.transportAuthRequired) {
    const user = await getUser(c, state.auth.config);
    if (!user) return c.text("Unauthorized", 401);
  }
  return wsHandler(c, next);
});

app.use("/static/*", serveStatic({ root: "./" }));

// ── Server with graceful shutdown ───────────────────────────────

const controller = new AbortController();
Deno.addSignalListener("SIGINT", () => controller.abort());
Deno.addSignalListener("SIGTERM", () => controller.abort());

const server = Deno.serve({
  hostname: config.bindAddress,
  port: config.port,
  signal: controller.signal,
  onListen: ({ port: p }) => {
    publish("platform:ready", { timestamp: Date.now() });
    logger.info("blenny-ts listening on port {port}", { port: p });

    const idleMs = config.idleTimeoutMs;
    setInterval(() => {
      const now = Date.now();
      let reaped = 0;
      for (const conn of hub.getConnections()) {
        if (conn.connType === "sse" && conn.lastWriteAt && now - conn.lastWriteAt > idleMs) {
          hub.removeConnection(conn.id);
          reaped++;
        }
      }
      if (reaped > 0) {
        logger.info("Reaped {count} idle SSE connections", { count: reaped });
      }
    }, idleMs);
  },
}, app.fetch);

await server.finished;

// 6. Stop modules in reverse order
for (const mod of modules.toReversed()) {
  await mod.stop?.();
  if (mod.stop) logger.info("Module stopped: {name}", { name: mod.name });
}

// 7. Close database
await state.db?.close();

logger.info("blenny-ts shutdown complete");
