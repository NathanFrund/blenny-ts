# Module directories

When a module outgrows a single file, it becomes a directory under `modules/`.
The directory _is_ the module — the same way a directory with `index.ts` is a
Deno/JS/TS module.

## Convention

```
modules/
  index.ts              ← single-file (unchanged)
  form-auth-surreal/    ← directory module
  forum/                ← multi-file module
    index.ts            ← exports BlennyModule default
    routes.ts           ← handler functions
    components.tsx      ← JSX components
    models.ts           ← types / schemas
    subscriptions.ts    ← event handlers
```

- `index.ts` is the entry point. It imports siblings, composes the
  `BlennyModule` object (name, routes, lifecycle hooks), and exports it as
  default.
- The module name defaults to the directory name (`"forum"`), overridable in the
  export.
- Single-file modules continue working unchanged.

## Loader

The framework's module loader scans your `modules/` directory for `.ts`/`.tsx`
files and directories:

```
for each entry in modules/:
  if file ending in .ts/.tsx  → import it directly
  if directory               → look for index.ts or index.tsx inside
  derive name:              filename (file) or directory name (dir)
```

The modules path is configurable in `blenny.json` via `modules.path` (default:
`"./src/modules"` for backward compatibility).

## Why

- A directory with `index.ts` _is_ a Deno module — `import("./forum/")` resolves
  naturally.
- No stub files, no config. Drop a directory in `modules/` and it loads. For
  compiled binaries, an auto-generated `manifest.ts` is created (see
  [Compiled Binaries & Module Manifest](modules.md#compiled-binaries--module-manifest)).
- Follows the same convention as every Deno/Node/TypeScript project.
