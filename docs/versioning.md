# Versioning

Blenny-ts follows [Semantic Versioning](https://semver.org/).

## Pre-1.0 (`0.x.y`)

| Bump                            | When                                                                |
| ------------------------------- | ------------------------------------------------------------------- |
| **Minor** (`0.2.0`, `0.3.0`, …) | Feature milestone — new module, subsystem, or meaningful capability |
| **Patch** (`0.2.1`, `0.2.2`, …) | Bug fixes, refactors, doc updates, instrumentation changes          |

Breaking changes are expected at this stage and do not require a major version
bump.

## Source of Truth

The current version is stored in the `version` field of `package.json`.

Tagging follows the `v` convention:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Use `npm version` to increment the field (it also commits the change and creates
the matching git tag):

```bash
npm version patch   # 0.2.0 → 0.2.1
npm version minor   # 0.2.1 → 0.3.0
```

> Telemetry is currently deferred (see [telemetry.md](telemetry.md)), so the
> version is no longer attached to OpenTelemetry tracer/meter resources.
