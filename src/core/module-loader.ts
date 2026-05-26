import { fromFileUrl, join, toFileUrl } from "@std/path";
import type { BlennyModule } from "../types.ts";

const modulesDir = fromFileUrl(new URL("../modules", import.meta.url));

export async function loadModules(): Promise<BlennyModule[]> {
  const modules: BlennyModule[] = [];

  try {
    for await (const entry of Deno.readDir(modulesDir)) {
      if (!entry.isFile || !(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        continue;
      }
      const fileUrl = toFileUrl(join(modulesDir, entry.name)).href;
      const mod = await import(fileUrl);
      if (mod.default && typeof mod.default === "object" && "routes" in mod.default) {
        modules.push(mod.default as BlennyModule);
        console.log(`[module-loader] loaded: ${mod.default.name ?? entry.name}`);
      }
    }
  } catch {
    console.warn("[module-loader] modules dir not found, skipping");
  }

  return modules;
}
