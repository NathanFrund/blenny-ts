import { fromFileUrl, join, resolve } from "@std/path";

const frameworkDir = fromFileUrl(new URL("..", import.meta.url));
const frameworkName = frameworkDir.split("/").filter(Boolean).pop()!;
const projectDir =
  Deno.realPathSync(frameworkDir) === Deno.realPathSync(Deno.cwd())
    ? resolve(frameworkDir, "..")
    : Deno.cwd();

const sourceModules = join(frameworkDir, "src", "modules");
const targetModules = join(projectDir, "modules");
const targetData = join(projectDir, "data");

async function copyDir(src: string, dest: string): Promise<void> {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    if (entry.name === "manifest.ts") continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (
      entry.isFile &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      let exists = false;
      try {
        await Deno.stat(destPath);
        exists = true;
      } catch {
        // not found — safe to copy
      }
      if (!exists) {
        await Deno.copyFile(srcPath, destPath);
        console.log("  copied", entry.name);
      }
    } else if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    }
  }
}

await Deno.mkdir(targetModules, { recursive: true });
console.log("Creating modules/ …");
await copyDir(sourceModules, targetModules);

await Deno.mkdir(targetData, { recursive: true });
console.log("Creating data/ …");

const blennyJson = {
  "modules.path": "./modules",
};

const denoJson = {
  tasks: {
    dev:
      `deno run --allow-net --allow-read --allow-write=./data --allow-sys --allow-env --allow-ffi --unstable-ffi --unstable-kv --watch ${frameworkName}/main.ts`,
    "generate-manifest":
      `deno run --allow-read --allow-write ${frameworkName}/tools/generate-manifest.ts --modules-path=./modules --out=${frameworkName}/src/modules/manifest.ts`,
    compile:
      `deno task generate-manifest && deno compile --allow-net --allow-read --allow-write=./data --allow-sys --allow-env --allow-ffi --unstable-kv --output ./app ${frameworkName}/main.ts`,
    test:
      `deno test --allow-read --allow-write --allow-sys --allow-env --unstable-kv`,
  },
  compilerOptions: {
    jsx: "precompile",
    jsxImportSource: "jsr:@hono/hono/jsx",
  },
  imports: {
    "@hono/hono": "jsr:@hono/hono@^4.12.23",
    "@starfederation/datastar-sdk": "npm:@starfederation/datastar-sdk@^1",
    "@std/assert": "jsr:@std/assert@^1.0.0",
    "@std/html": "jsr:@std/html@^1.0.7",
    "@std/path": "jsr:@std/path@^1.0.0",
    "@surrealdb/surrealdb": "npm:surrealdb@^2",
    "@logtape/logtape": "jsr:@logtape/logtape@^2.1.1",
    "@valibot/valibot": "jsr:@valibot/valibot@^1.4.1",
    "@kitsonk/kv-toolbox": "jsr:@kitsonk/kv-toolbox@^0.28.1",
    "@blenny/types": `./${frameworkName}/src/types.ts`,
    "@blenny/core/": `./${frameworkName}/src/core/`,
    "@blenny/lib/": `./${frameworkName}/src/lib/`,
    "@opentelemetry/api": "npm:@opentelemetry/api@^1.9.0",
    "@opentelemetry/sdk-trace-base":
      "npm:@opentelemetry/sdk-trace-base@^1.30.0",
  },
};

const gitignore = [
  "data/",
  `${frameworkName}/src/modules/manifest.ts`,
  "",
].join("\n");

const files: [string, string][] = [
  ["blenny.json", JSON.stringify(blennyJson, null, 2) + "\n"],
  ["deno.json", JSON.stringify(denoJson, null, 2) + "\n"],
  [".gitignore", gitignore],
];

for (const [name, content] of files) {
  const path = join(projectDir, name);
  let exists = false;
  try {
    await Deno.stat(path);
    exists = true;
  } catch {
    // not found
  }
  if (!exists) {
    await Deno.writeTextFile(path, content);
    console.log(`Creating ${name} …`);
  } else {
    console.log(`Skipping ${name} (already exists)`);
  }
}

const cdUp = projectDir !== Deno.cwd() ? "cd .. && " : "";
console.log("\nDone. Run:\n");
console.log(`  ${cdUp}deno task dev`);
