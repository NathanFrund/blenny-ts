# Blenny-ts

A Deno/TypeScript port of the [Blenny](https://github.com/anomalyco/blenny) web framework — a hypermedia-driven, real-time, single-binary platform.

## Quick Start

```bash
git clone <repo> && cd blenny-ts
deno task dev
```

Opens on `http://localhost:3000` by default.

### Configure

Supply overrides via any priority order:

```bash
# 1. CLI args
deno run --allow-net --allow-env --allow-read main.ts --server.port=8080

# 2. Environment variables
BLENNY_SERVER_PORT=8080 deno task dev

# 3. blenny.json (in working directory)
echo '{ "server.port": "8080" }' > blenny.json

# See blenny.example.json for all keys
```

## Structure

```
src/
  core/        Framework internals (hub, conduit, auth, config, database)
  modules/     Drop-in modules auto-discovered at startup
main.ts        Server entrypoint
tests/         Test suite matching src/ layout
```

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Modules** | Self-contained route + subscription units. Drop a `.ts` file into `src/modules/` and it loads automatically. |
| **TransportHub** | Manages SSE and WebSocket connections. Broadcasts messages to clients with intent-based filtering. |
| **Conduit** | HTMX-aware JSX renderer. Wraps content in a layout on full page loads, returns fragments on HTMX swaps. |
| **Config** | Composite provider — CLI > env > `blenny.json` > embedded defaults. All dotted keys. |
| **Auth** | Pluggable via modules. Ships with a reference in-memory auth module (SHA-256, registration, JWT cookies). |

## Test

```bash
deno test --allow-read --allow-env
```

## Build

```bash
deno task compile
./blenny-ts --server.port=8080
```

## Docs

- [Architecture](docs/architecture.md)
- [Writing Modules](docs/modules.md)
