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

The current version is stored in the `version` field of `deno.json`. The OTel
tracer and meter in `src/core/tracing.ts` track this value so telemetry data is
identifiable by release.

Tagging follows the `v` convention:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The `deno bump-version` subcommand can increment the field automatically:

```bash
deno bump-version patch   # 0.2.0 → 0.2.1
deno bump-version minor   # 0.2.1 → 0.3.0
```
