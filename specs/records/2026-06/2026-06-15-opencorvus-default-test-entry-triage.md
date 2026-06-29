# OpenCorvus default test entry triage

Date: 2026-06-15

## Evidence

`packages/opencorvus/package.json` previously allowed the default `bun test` entry to exercise only a narrow script subset. Running the uncovered package test directories directly exposed deterministic fixture drift before the suite reached the larger integration failures:

- `test/engine-goal-contract-runtime-split.test.ts` and `test/engine-goal-retry-count-derived.test.ts` searched the TypeScript source for an unquoted SQL table declaration. The storage layer now exposes generated schema through `SCHEMA_DDL`, where table names are quoted.
- `test/requirements/maturity-word-discipline.test.ts` expected requirement records without the current `evidence_refs` field.
- `test/task-api/mission-task-title-format.test.ts` created mission tasks without an `opencorvus.json` model, violating the strict no-fallback model contract.

## Call-site scan

- `rg -n "SCHEMA_DDL|CREATE TABLE IF NOT EXISTS .*engine_goal|retry_count|workspace_dir" packages/opencorvus/test packages/opencorvus/src`
- `rg -n "evidence_refs" packages/opencorvus/test packages/opencorvus/src`
- `rg -n "opencorvus\\.json|MissingModelConfigError|model.*test|test/mock" packages/opencorvus/test/task-api packages/opencorvus/test/engine packages/opencorvus/test/orchestrator packages/opencorvus/test/fixture packages/opencorvus/src`

## Decision

Keep the production strict model contract unchanged. Tests that create tasks through `EngineService` must declare the project model via the existing `tmpdir({ config })` fixture instead of relying on historical defaults. Schema assertions should consume `SCHEMA_DDL`, the runtime DDL source, rather than grep the TypeScript file formatting.

This is a targeted cleanup of deterministic test drift. The broader default test entry still needs a separate pass because the direct uncovered-directory run also exposed integration failures that must be isolated file-by-file before expanding the package default script.
