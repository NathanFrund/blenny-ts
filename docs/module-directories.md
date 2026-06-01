# Module directories

When a module outgrows a single file, it becomes a directory under
`src/modules/`.  The directory *is* the module — the same way a directory
with `index.ts` is a Deno/JS/TS module.

## Convention

```
src/modules/
  hello.ts              ← single-file (unchanged)
  form-auth.tsx         ← single-file (unchanged)
  forum/                ← multi-file module
    index.ts            ← exports BlennyModule default
    routes.ts           ← handler functions
    components.tsx      ← JSX components
    models.ts           ← types / schemas
    subscriptions.ts    ← event handlers
```

- `index.ts` is the entry point.  It imports siblings, composes the
  `BlennyModule` object (name, routes, lifecycle hooks), and exports it as
  default.
- The module name defaults to the directory name (`"forum"`), overridable
  in the export.
- Single-file modules continue working unchanged.

## Loader change

`src/core/module-loader.ts` currently scans `src/modules/` for `.ts`/`.tsx`
files.  It is extended to also scan directories:

```
for each entry in modules/:
  if file ending in .ts/.tsx  → import it directly (current path)
  if directory               → look for index.ts or index.tsx inside
  derive name:              filename (file) or directory name (dir)
```

The change is ~10 lines.  Backward-compatible — no existing module needs
changes.

## Why

- A directory with `index.ts` *is* a Deno module — `import("./forum/")`
  resolves naturally.
- No stub files, no config, no manifest.  Drop a directory in `modules/`
  and it loads.
- Follows the same convention as every Deno/Node/TypeScript project.
