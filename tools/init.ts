import { realpathSync } from "node:fs";
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frameworkDir = fileURLToPath(new URL("..", import.meta.url));
const frameworkName = basename(frameworkDir);
const projectDir =
  realpathSync(frameworkDir) === realpathSync(process.cwd()) ? resolve(frameworkDir, "..") : process.cwd();

const sourceModules = join(frameworkDir, "src", "modules");
const targetModules = join(projectDir, "modules");
const targetData = join(projectDir, "data");

async function copyDir(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.name === "manifest.ts") continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      let exists = false;
      try {
        await stat(destPath);
        exists = true;
      } catch {
        // not found — safe to copy
      }
      if (!exists) {
        await copyFile(srcPath, destPath);
        console.log("  copied", entry.name);
      }
    } else if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    }
  }
}

await mkdir(targetModules, { recursive: true });
console.log("Creating modules/ …");
await copyDir(sourceModules, targetModules);

await mkdir(targetData, { recursive: true });
console.log("Creating data/ …");

const blennyJson = {
  "modules.path": "./modules",
};

const packageJson = {
  name: "blenny-app",
  private: true,
  type: "module",
  scripts: {
    dev: `bun run --watch ${frameworkName}/main.ts`,
    "generate-manifest": `bun ${frameworkName}/tools/generate-manifest.ts --modules-path=./modules --out=${frameworkName}/src/modules/manifest.ts`,
    compile: `bun run generate-manifest && bun build ${frameworkName}/main.ts --compile --outfile app`,
    test: `bun test`,
    lint: "biome check .",
    "lint:fix": "biome check --write .",
    format: "biome format --write .",
    "format:check": "biome format .",
  },
  dependencies: {
    "@hono/hono": "npm:hono@4.12.23",
    "@logtape/logtape": "2.1.1",
    "@starfederation/datastar-sdk": "1.0.0",
    "@surrealdb/surrealdb": "npm:surrealdb@2.0.3",
    "@valibot/valibot": "npm:valibot@1.4.1",
  },
  devDependencies: {
    "@biomejs/biome": "2.5.15",
    "@types/bun": "1.4.3",
    typescript: "5.9.3",
  },
};

const tsconfigJson = {
  compilerOptions: {
    target: "ESNext",
    module: "ESNext",
    moduleResolution: "bundler",
    lib: ["ESNext", "DOM", "DOM.Iterable"],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowImportingTsExtensions: true,
    isolatedModules: true,
    forceConsistentCasingInFileNames: true,
    jsx: "react-jsx",
    jsxImportSource: "@hono/hono/jsx",
    types: ["bun"],
    paths: {
      "@blenny/types": [`./${frameworkName}/src/types.ts`],
      "@blenny/core/*": [`./${frameworkName}/src/core/*`],
      "@blenny/lib/*": [`./${frameworkName}/src/lib/*`],
    },
  },
  include: ["modules/**/*", `${frameworkName}/main.ts`],
};

const bunfigToml = ["# Bun configuration.", "# Formatting and linting are handled by Biome (see biome.json).", ""].join(
  "\n",
);

const biomeJson = {
  $schema: "./node_modules/@biomejs/biome/configuration_schema.json",
  vcs: { enabled: true, clientKind: "git", useIgnoreFile: true },
  files: { includes: ["**", "!**/*.bak", "!**/*.svg"] },
  formatter: {
    enabled: true,
    indentStyle: "space",
    indentWidth: 2,
    lineWidth: 120,
  },
  javascript: {
    formatter: {
      quoteStyle: "double",
      jsxQuoteStyle: "double",
      semicolons: "always",
      trailingCommas: "all",
      arrowParentheses: "always",
    },
  },
  linter: { enabled: true, rules: { preset: "recommended" } },
  assist: { enabled: true, actions: { source: { organizeImports: "on" } } },
};

const gitignore = ["data/", "node_modules/", `${frameworkName}/src/modules/manifest.ts`, "/app", ".DS_Store", ""].join(
  "\n",
);

const files: [string, string][] = [
  ["blenny.json", JSON.stringify(blennyJson, null, 2) + "\n"],
  ["package.json", JSON.stringify(packageJson, null, 2) + "\n"],
  ["tsconfig.json", JSON.stringify(tsconfigJson, null, 2) + "\n"],
  ["biome.json", JSON.stringify(biomeJson, null, 2) + "\n"],
  ["bunfig.toml", bunfigToml],
  [".gitignore", gitignore],
];

for (const [name, content] of files) {
  const path = join(projectDir, name);
  let exists = false;
  try {
    await stat(path);
    exists = true;
  } catch {
    // not found
  }
  if (!exists) {
    await writeFile(path, content);
    console.log(`Creating ${name} …`);
  } else {
    console.log(`Skipping ${name} (already exists)`);
  }
}

const cdUp = projectDir !== process.cwd() ? "cd .. && " : "";
console.log("\nDone. Run:\n");
console.log(`  ${cdUp}bun install`);
console.log(`  ${cdUp}bun run dev`);
