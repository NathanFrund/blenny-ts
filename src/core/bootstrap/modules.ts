import type { Hono, MiddlewareHandler } from "@hono/hono";
import { connectDatabase } from "../database.ts";
import { loadModules } from "../module-loader.ts";
import { subscribe } from "../hub.ts";
import type { AppState } from "../app-state.ts";
import type { BlennyConfig } from "../config.ts";
import type { BlennyLogger } from "../logger.ts";
import type { BlennyEvents, BlennyModule, HttpMethod } from "../../types.ts";
import { withRouteSpan } from "./routing.ts";

export interface ModuleLoadResult {
  modules: BlennyModule[];
  failures: { file: string; error: string; stack?: string }[];
}

export async function discoverModules(
  logger: BlennyLogger,
  config: BlennyConfig,
): Promise<ModuleLoadResult> {
  const { modules, failures } = await loadModules();
  for (const mod of modules) {
    logger.info("Module loaded: {name}", { name: mod.name });
  }
  if (config.devMode) {
    for (const f of failures) {
      logger.error("Module load failure: {file} — {error}", {
        file: f.file,
        error: f.error,
        stack: f.stack,
      });
    }
  } else {
    for (const f of failures) {
      logger.warn("Module load failure: {file}", { file: f.file });
    }
  }
  return { modules, failures };
}

export function detectCapabilityConflicts(modules: BlennyModule[]): void {
  const capabilityOwners = new Map<string, string>();
  for (const mod of modules) {
    if (!mod.capabilities) continue;
    for (const cap of mod.capabilities) {
      const existing = capabilityOwners.get(cap);
      if (existing) {
        throw new Error(
          `Capability "${cap}" conflict: "${existing}" and "${mod.name}" both declare it`,
        );
      }
      capabilityOwners.set(cap, mod.name);
    }
  }
}

export async function setupDatabase(
  state: AppState,
  config: BlennyConfig,
  logger: BlennyLogger,
): Promise<void> {
  state.db = (await connectDatabase(config, logger)) ?? undefined;
}

export async function initializeModules(
  modules: BlennyModule[],
  state: AppState,
  logger: BlennyLogger,
): Promise<void> {
  for (const mod of modules) {
    await mod.initialize?.(state);
    logger.info("Module initialized: {name}", { name: mod.name });
  }
}

export function applyAuthMiddleware(app: Hono, state: AppState): void {
  if (state.auth) {
    app.use("*", state.auth.middleware);
  }
}

export function registerModuleRoutes(
  app: Hono,
  modules: BlennyModule[],
  state: AppState,
  logger: BlennyLogger,
): void {
  for (const mod of modules) {
    for (const route of mod.routes) {
      const method = route.method as HttpMethod;
      const handler = withRouteSpan(
        { path: route.path, method: route.method },
        route.handler as unknown as MiddlewareHandler,
      );
      if (route.auth && state.auth) {
        const guard: MiddlewareHandler = typeof route.auth === "string"
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
}

export function subscribeModuleEvents(
  modules: BlennyModule[],
  logger: BlennyLogger,
): void {
  for (const mod of modules) {
    if (mod.subscriptions) {
      for (const sub of mod.subscriptions) {
        subscribe(
          sub.topic as keyof BlennyEvents,
          sub.handler as (payload: unknown) => void,
        );
        logger.debug("Event subscription: {module} -> {topic}", {
          module: mod.name,
          topic: sub.topic,
        });
      }
    }
  }
}

export async function startModules(
  modules: BlennyModule[],
  logger: BlennyLogger,
): Promise<void> {
  for (const mod of modules) {
    await mod.start?.();
    if (mod.start) logger.info("Module started: {name}", { name: mod.name });
  }
}

export async function stopModules(
  modules: BlennyModule[],
  state: AppState,
  logger: BlennyLogger,
): Promise<void> {
  for (const mod of modules.toReversed()) {
    await mod.stop?.();
    if (mod.stop) logger.info("Module stopped: {name}", { name: mod.name });
  }
  await state.db?.close();
}
