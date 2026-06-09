import type { Hono, MiddlewareHandler } from "@hono/hono";
import { connectDatabase } from "../database.ts";
import { loadModules } from "../module-loader.ts";
import { publish, subscribe } from "../hub.ts";
import type { AppState } from "../app-state.ts";
import type { BlennyConfig } from "../config.ts";
import type { BlennyEvents, BlennyModule, HttpMethod } from "../../types.ts";
import { withRouteSpan } from "./routing.ts";

export interface ModuleLoadResult {
  modules: BlennyModule[];
  failures: { file: string; error: string; stack?: string }[];
}

export async function discoverModules(
  config: BlennyConfig,
): Promise<ModuleLoadResult> {
  const { modules, failures } = await loadModules();
  for (const mod of modules) {
    publish("log", {
      level: "info",
      template: "Module loaded: {name}",
      args: { name: mod.name },
    });
  }
  if (config.devMode) {
    for (const f of failures) {
      publish("log", {
        level: "error",
        template: "Module load failure: {file} — {error}",
        args: { file: f.file, error: f.error, stack: f.stack },
      });
    }
  } else {
    for (const f of failures) {
      publish("log", {
        level: "warn",
        template: "Module load failure: {file}",
        args: { file: f.file },
      });
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

export function detectMissingDependencies(modules: BlennyModule[]): void {
  const provided = new Set(modules.flatMap((m) => m.capabilities ?? []));
  for (const mod of modules) {
    for (const req of mod.requires ?? []) {
      if (!provided.has(req)) {
        throw new Error(
          `Module "${mod.name}" requires "${req}" but no loaded module provides it`,
        );
      }
    }
  }
}

export async function setupDatabase(
  state: AppState,
  config: BlennyConfig,
): Promise<void> {
  state.db = (await connectDatabase(config)) ?? undefined;
}

export async function initializeModules(
  modules: BlennyModule[],
  state: AppState,
): Promise<void> {
  for (const mod of modules) {
    await mod.initialize?.(state);
    publish("log", {
      level: "info",
      template: "Module initialized: {name}",
      args: { name: mod.name },
    });
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
      publish("log", {
        level: "debug",
        template: "Route registered: {method} {path} -> {module}",
        args: {
          method: route.method,
          path: route.path,
          module: mod.name,
        },
      });
    }
  }
}

export function subscribeModuleEvents(
  modules: BlennyModule[],
): void {
  for (const mod of modules) {
    if (mod.subscriptions) {
      for (const sub of mod.subscriptions) {
        subscribe(
          sub.topic as keyof BlennyEvents,
          sub.handler as (payload: unknown) => void | Promise<void>,
        );
        publish("log", {
          level: "debug",
          template: "Event subscription: {module} -> {topic}",
          args: { module: mod.name, topic: sub.topic },
        });
      }
    }
  }
}

export async function startModules(
  modules: BlennyModule[],
  state: AppState,
): Promise<void> {
  for (const mod of modules) {
    await mod.start?.();
    if (mod.start) {
      publish("log", {
        level: "info",
        template: "Module started: {name}",
        args: { name: mod.name },
      });
    }
  }
  state.supervisor.start();
}

export async function stopModules(
  modules: BlennyModule[],
  state: AppState,
): Promise<void> {
  state.supervisor.stop();
  state.hub.closeAllConnections();
  state.hub.stopReaper();
  for (const mod of modules.toReversed()) {
    await mod.stop?.();
    if (mod.stop) {
      publish("log", {
        level: "info",
        template: "Module stopped: {name}",
        args: { name: mod.name },
      });
    }
  }
  await state.db?.close();
}
