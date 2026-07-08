# DB Write Boundary Refactor

## Recall

User request:

- Open a new worktree.
- Define a detailed goal and start the database write-boundary refactor.
- Prohibit future unscientific database implementation.

Acceptance criteria:

- Work happens in a new git worktree so the dirty main workspace is preserved.
- Persist this task record before code edits.
- Keep DB as the source of truth while eliminating scattered production writes to shared engine tables.
- Start with a concrete, test-backed vertical slice rather than a vague architecture note.
- Add a regression that prevents new production code from directly writing `EngineArtifactTable` outside the allowed persistence layer.
- Do not add fallback logic, compatibility branches, runtime gates, hidden messages, or state-machine patches.

Hard constraints:

- Main worktree dirty state must not be overwritten or reverted.
- New worktree is authorized by the current user request.
- Current branch prefix uses `codex/`; commit subject must use the active delivery prefix from `AGENTS.md`.
- Specs must stay under `specs/records/2026-07/` and be indexed from the July README.
- Code changes need targeted tests.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/current/architecture/10-worktree-lifecycle.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/current/architecture/99-principles.md`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/src/engine/engine.sql.ts`
- `packages/opencorvus/src/acceptance/manifest.ts`
- `packages/opencorvus/src/browser-preview/persist.ts`
- `packages/opencorvus/src/verification/persist.ts`
- `packages/opencorvus/src/fact-check/persist.ts`
- `packages/opencorvus/src/frontend-design/design-resource-manifest.ts`
- `packages/opencorvus/src/plugin/index.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`

Whole-repository search evidence:

- `rg -n "db\\.(insert|update|delete)\\(Engine[A-Za-z]+Table|\\.(insert|update|delete)\\(Engine[A-Za-z]+Table" packages/opencorvus/src -g "*.ts"`
- `rg -n "EngineArtifactTable|EngineTaskTable|EngineGoalTable|EngineSpecSnapshotTable|EnginePlanVersionTable|EnginePlanNodeTable|EngineProgressSnapshotTable|EngineInteractionRequestTable|EngineChannelBindingTable" packages/opencorvus/src -g "*.ts"`
- `rg -n "artifact-centric|engine_artifact|persistEvidence|persistBrowserPreviewTarget|recordFactCheckAttempt|recordDesignResourceManifest|PluginTaskArtifact|AcceptanceEvidenceManifest|EngineArtifactKind" specs/current specs/records/2026-07 specs/records/2026-06 packages/opencorvus/src packages/opencorvus/test -g "*.md" -g "*.ts"`

Independent agent feedback:

- No independent sub-agent was spawned for this first slice. The current request authorized a new git worktree, not parallel sub-agent review.

## Worktree

New worktree:

- Path: `C:\Users\chuan\myhexin-local\opecorvus-db-write-boundary`
- Branch: `codex/db-write-boundary-refactor`
- Base commit: `944ca18cea dsw-33987 harden expert squad release schema`

The original worktree remains dirty and untouched.

## Detailed Goal

Goal ID: `db-write-boundary-refactor-g1`

Objective:

Centralize production writes to `engine_artifact` behind a shared engine-owned write API, migrate the first high-risk cross-domain artifact writers to that API, and install an architecture regression that fails when future production modules directly call `db.insert/update/delete(EngineArtifactTable)`.

Scope:

- Add an engine-owned artifact writer module that owns insert/update column mapping for `EngineArtifactTable`.
- Migrate non-engine production writers in:
  - `acceptance/manifest.ts`
  - `acceptance/specialist-review.ts`
  - `acceptance/visual-feedback-verification.ts`
  - `browser-preview/persist.ts`
  - `verification/persist.ts`
  - `fact-check/persist.ts`
  - `frontend-design/design-resource-manifest.ts`
  - `plugin/index.ts`
  - the `exploration` artifact write in `orchestrator/tools.ts`
- Add a static architecture test that allows direct `EngineArtifactTable` writes only inside engine persistence modules and `task-api/index.ts`.
- Update current data architecture text so future work treats artifact writes as service-owned, not table-owned by every feature module.

Out of scope for this first slice:

- Full migration of `engine_task`, `engine_goal`, plan/spec, queue, interaction, and metric writes.
- MySQL runtime port.
- Frontend UI changes.
- Database schema changes.

Risks:

- Some existing engine-internal modules still write engine tables directly. This slice does not hide that; the next goals must move them behind dedicated lifecycle writers.
- Read-side queries still import `EngineArtifactTable`. Read projections are intentionally left unchanged in this slice.

## Implementation Plan

1. Add `packages/opencorvus/src/engine/artifact.ts` with `insertEngineArtifact`, `recordEngineArtifact`, and `updateEngineArtifact`.
2. Replace cross-domain direct artifact inserts/updates with those functions.
3. Add `packages/opencorvus/test/script/db-write-boundary.test.ts` to scan production TypeScript and fail on disallowed direct artifact writes.
4. Update `specs/current/architecture/02-data.md` to name the engine artifact writer as the persistence boundary.
5. Run targeted tests for migrated domains and the new script test.
6. Commit and push this first slice from the new worktree.

## Follow-Up Goals

1. Move `orchestrator/tools.ts` plan/spec/goal writes into engine persistence APIs.
2. Move engine queue/runtime/stage-continuation/tool-ownership artifact writes into the shared artifact writer while preserving their lifecycle semantics.
3. Introduce typed payload schemas for high-volume artifact kinds where payload corruption has caused UI or scheduler failures.
4. Split MySQL portability work into a later goal after write boundaries are stable.
