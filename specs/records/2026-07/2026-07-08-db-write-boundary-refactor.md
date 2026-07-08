# 2026-07-08 Database Write Boundary Refactor

## Recall

| Field                            | Content                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ | ---------- | ------------ | ------------ | -------------------------------------------------------------------------------------------------------- | ------ | ----------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request                     | The backend database write model is wrong: each module appears to solve database reads and writes independently, which violates layered architecture. The user asked how serious it is, whether fixing it helps MySQL migration, whether frontend UI code must change, and then explicitly requested a new worktree, a detailed goal, the start of the refactor, and a durable prohibition against unscientific database implementation. |
| Acceptance criteria              | Create a new git worktree; define a concrete refactor goal; record the goal and constraints under `specs/`; start the database write-boundary refactor in code; add a test that prevents future production code from writing core DB tables outside the approved boundary; keep frontend UI unchanged unless API or projection contracts change.                                                                                         |
| Hard constraints                 | No fallback, no compatibility path, no dual-source write model, no runtime gate to hide the issue, no blind patching, no git reset, preserve unrelated dirty worktree changes, use mature database layering rather than ad hoc SQL ownership, and keep specs under root `specs/`.                                                                                                                                                        |
| Sources read                     | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/09-verification-evidence.md`; `specs/current/architecture/10-worktree-lifecycle.md`; `specs/current/architecture/16-unified-teardown.md`; `specs/current/architecture/99-principles.md`; `packages/opencorvus/src/storage/db.ts`; `packages/opencorvus/src/engine/engine.sql.ts`.                |
| Whole-repository search evidence | `rg -n "Database\\.                                                                                                                                                                                                                                                                                                                                                                                                                      | db\\.(insert | update | delete)\\( | \\.insert\\( | \\.update\\( | \\.delete\\(" packages/opencorvus/src -g "\*.ts"`found broad direct database writes.`rg -n "db\\.(insert | update | delete)\\(EngineArtifactTable | \\.(insert | update | delete)\\(EngineArtifactTable" packages/opencorvus/src -g "\*.ts"` showed cross-domain direct writes in acceptance, browser-preview, verification, fact-check, frontend-design, plugin, and orchestrator modules before this slice. |
| Independent agent feedback       | None spawned for this first slice. The scope is narrow enough to validate by source inventory, architecture tests, and targeted domain tests.                                                                                                                                                                                                                                                                                            |

## Worktree

- Path: `C:\Users\chuan\myhexin-local\opecorvus-db-write-boundary`
- Branch: `codex/db-write-boundary-refactor`
- Base commit: `944ca18cea dsw-33987 harden expert squad release schema`

The main worktree had unrelated dirty and untracked user changes. This refactor worktree keeps those changes untouched.

## Goal

`db-write-boundary-refactor-g1`: establish a real database write boundary for the `engine_artifact` process table, migrate non-engine production modules to the engine-owned artifact writer, and add a regression test that blocks future non-engine direct writes to `EngineArtifactTable`.

This is intentionally a first vertical slice, not a cosmetic rename. The serious architecture issue is that `engine_artifact` has become a shared universal table where domain modules directly encode their own write semantics. That makes invariants hard to audit, makes table evolution expensive, and makes a future MySQL migration riskier because SQL, transaction shape, ID generation, timestamps, and update semantics are scattered.

## Scope

In scope for this slice:

- Add an engine-owned artifact writer module.
- Replace non-engine direct artifact writes in acceptance, browser-preview, verification, fact-check, frontend-design, plugin, and orchestrator exploration persistence.
- Keep reads stable where they are projection/query concerns.
- Update architecture docs so `engine/artifact.ts` is the explicit artifact write boundary.
- Add a script test that fails when production modules outside `engine/**` or `task-api/index.ts` directly insert, update, or delete `EngineArtifactTable`.

Out of scope for this slice:

- Full repository migration of every `engine_*` table write.
- Schema redesign or DB migration. This project resets DBs for schema changes instead of carrying historical migration compatibility.
- Frontend UI changes. UI only needs changes when API response shapes, SSE events, or projection DTOs change; this slice preserves those contracts.

## Implementation Plan

1. Create `packages/opencorvus/src/engine/artifact.ts` with insert/update helpers that own ID, timestamp, nullable FK, and payload write shape for `engine_artifact`.
2. Migrate cross-domain artifact writes to the writer while preserving existing labels, kinds, payloads, timestamps, and emitted events.
3. Add a production-source architecture test for non-engine direct `EngineArtifactTable` writes.
4. Update `specs/current/architecture/02-data.md` to make the new boundary explicit.
5. Run targeted tests for the migrated domains plus documentation health tests.

## Follow-Up Goals

- Collapse remaining direct `engine_artifact` writes inside `engine/**` into narrower command-style methods grouped by lifecycle semantics.
- Establish similar write-boundary tests for other core `engine_*` tables after their service ownership is documented.
- After table ownership is centralized, evaluate the SQL dialect assumptions that still block a MySQL storage implementation.
