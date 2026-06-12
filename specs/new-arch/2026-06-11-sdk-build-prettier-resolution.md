# SDK build Prettier resolution fix

## Problem

`bun run build:overlay` fails during the SDK (Software Development Kit) rebuild step because `packages/sdk/js/script/build.ts` runs `bun prettier --write src`. On Bun 1.3.14 for Windows, that command is resolved as a package script named `prettier`, not as the repository-installed Prettier binary.

## Evidence

Full-repository search for Prettier execution found the failing SDK build call and related formatter invocations:

| Path | Decision |
| --- | --- |
| `packages/sdk/js/script/build.ts` | Replace `bun prettier --write src` with an explicit resolved Prettier binary invocation. |
| `script/format.ts` | Leave unchanged; it is a root developer formatting command and not part of the overlay build failure. |
| `script/stats.ts` | Leave unchanged; unrelated stats generation helper. |
| `packages/opencorvus/src/format/formatter.ts` | Leave unchanged; runtime formatter registry intentionally invokes user project tooling. |
| Docs and formatter docs | Leave unchanged; they document user-facing formatter behavior. |

## Fix

Resolve `prettier/bin/prettier.cjs` from the SDK package with `Bun.resolve(...)` and invoke that exact file via Bun. This keeps the build tied to the repository dependency graph instead of relying on Bun's bare-command or global-cache behavior.

## Tests

Add a source-level contract test asserting the SDK build script resolves Prettier explicitly and no longer invokes `bun prettier`.
