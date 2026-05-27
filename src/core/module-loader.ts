import { fromFileUrl, join, toFileUrl } from "@std/path";
import { HTTP_METHODS } from "../types.ts";
import type { BlennyModule, Route } from "../types.ts";

const modulesDir = fromFileUrl(new URL("../modules", import.meta.url));
const VALID_METHODS = new Set<string>(HTTP_METHODS);

export interface ModuleLoadFailure {
  file: string;
  error: string;
  stack?: string;
}

export interface ModuleLoadResult {
  modules: BlennyModule[];
  failures: ModuleLoadFailure[];
}

function validateModule(candidate: unknown, fileName: string): { mod?: BlennyModule; err?: string } {
  if (!candidate || typeof candidate !== "object") {
    return { err: "no default BlennyModule export" };
  }

  const obj = candidate as Record<string, unknown>;

  if (!Array.isArray(obj.routes)) {
    return { err: "routes must be an array" };
  }

  const validatedRoutes: Route[] = [];
  for (let i = 0; i < obj.routes.length; i++) {
    const r = obj.routes[i] as Record<string, unknown>;
    if (!r || typeof r !== "object") {
      return { err: `routes[${i}] is not an object` };
    }
    if (typeof r.method !== "string" || !VALID_METHODS.has(r.method)) {
      return { err: `routes[${i}].method must be one of GET|POST|PUT|DELETE` };
    }
    if (typeof r.path !== "string" || r.path.length === 0) {
      return { err: `routes[${i}].path must be a non-empty string` };
    }
    if (typeof r.handler !== "function") {
      return { err: `routes[${i}].handler must be a function` };
    }
    if (r.auth !== undefined && typeof r.auth !== "boolean" && typeof r.auth !== "string") {
      return { err: `routes[${i}].auth must be a boolean or string` };
    }
    validatedRoutes.push({
      method: r.method as Route["method"],
      path: r.path,
      handler: r.handler as Route["handler"],
      auth: r.auth as Route["auth"],
    });
  }

  if (obj.subscriptions !== undefined) {
    if (!Array.isArray(obj.subscriptions)) {
      return { err: "subscriptions must be an array" };
    }
    for (let i = 0; i < obj.subscriptions.length; i++) {
      const s = obj.subscriptions[i] as Record<string, unknown>;
      if (!s || typeof s !== "object") {
        return { err: `subscriptions[${i}] is not an object` };
      }
      if (typeof s.topic !== "string") {
        return { err: `subscriptions[${i}].topic must be a string` };
      }
      if (typeof s.handler !== "function") {
        return { err: `subscriptions[${i}].handler must be a function` };
      }
    }
  }

  const name = typeof obj.name === "string" && obj.name.length > 0
    ? obj.name
    : fileName.replace(/\.(ts|tsx)$/, "");

  const mod: BlennyModule = { name, routes: validatedRoutes };

  if (obj.layout !== undefined) {
    if (typeof obj.layout !== "function") {
      return { err: "layout must be a function" };
    }
    mod.layout = obj.layout as BlennyModule["layout"];
  }

  if (obj.subscriptions !== undefined) {
    mod.subscriptions = (obj.subscriptions as Array<Record<string, unknown>>).map((s) => ({
      topic: String(s.topic),
      handler: s.handler as (payload: unknown) => void,
    }));
  }

  if (obj.capabilities !== undefined) {
    if (!Array.isArray(obj.capabilities) || !obj.capabilities.every((c: unknown) => typeof c === "string")) {
      return { err: "capabilities must be an array of strings" };
    }
    mod.capabilities = obj.capabilities as string[];
  }

  if (typeof obj.initialize === "function") mod.initialize = obj.initialize as BlennyModule["initialize"];
  if (typeof obj.start === "function") mod.start = obj.start as BlennyModule["start"];
  if (typeof obj.stop === "function") mod.stop = obj.stop as BlennyModule["stop"];

  return { mod };
}

export async function loadModules(): Promise<ModuleLoadResult> {
  const modules: BlennyModule[] = [];
  const failures: ModuleLoadFailure[] = [];

  try {
    for await (const entry of Deno.readDir(modulesDir)) {
      if (!entry.isFile || !(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        continue;
      }
      const fileName = String(entry.name);
      const fileUrl = toFileUrl(join(modulesDir, fileName)).href;
      try {
        const mod = await import(fileUrl);
        const result = validateModule(mod.default, fileName);
        if (result.mod) {
          modules.push(result.mod);
        } else {
          failures.push({ file: fileName, error: result.err! });
        }
      } catch (err) {
        failures.push({
          file: fileName,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      failures.push({ file: String(modulesDir), error: "modules dir not found" });
    } else {
      failures.push({
        file: String(modulesDir),
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }

  return { modules, failures };
}
