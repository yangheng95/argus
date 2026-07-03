# Multi-Task Storage Namespace Consensus

Date: 2026-07-03
Status: Revised after independent review

## Recall

| Item | Details |
| --- | --- |
| User request | Design a consensus plan for independent agent review after the failed-goal investigation showed many failures were caused by cross-project attachment refs, missing `.opencorvus/r/b/a/*.png` blobs, and one independent provider 401. The user explicitly rejected the earlier unsupported attribution that `source row` / `visual source row` goal names directly caused the failures. |
| Acceptance criteria | The plan must distinguish user-visible project/Mission/task from backend `project_id`; explain why one canonical project worktree/common Git identity cannot provide complete Database (DB) and runtime isolation through multiple backend `project_id` rows; identify the direct Build evidence failure chain; propose the correct architecture without fallback, gate, compatibility tolerance, DB reset, or prompt-only masking; hand the concrete plan to independent agents for review before implementation and integrate their findings. |
| Hard constraints | No fallback/compatibility logic; no cross-project attachment tolerance; no gate mechanism; no blind patch; no git reset; no new worktree; do not restart, kill, refresh, or otherwise disturb OpenCorvus/overlay processes; specs must live under root `specs/`; include this Recall section; use whole-repository grep before landing the plan; preserve unrelated dirty worktree changes. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/10-worktree-lifecycle.md`; `specs/records/2026-07/2026-07-03-project-exact-worktree-identity-convergence.md`; `specs/records/2026-07/2026-07-03-attachment-replay-lifecycle-root-repair.md`; `specs/records/2026-07/2026-07-02-build-evidence-pack-role-separation.md`; `packages/opencorvus/src/project/runtime-paths.ts`; `packages/opencorvus/src/storage/attachment-store.ts`; prior remote run artifact evidence for `run_f2447eee4001CewhvZRby1xEqG`. |
| Whole-repository search evidence | `rg -n "project_id|ProjectTable|fromDirectory\(|directoryProjectID|WorktreeIdentityConflictError|assertNoEmbeddedProjectIDReferences|mergeExactWorktreeRows" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 specs/records/2026-06 -g "*.ts" -g "*.md"`; `rg -n "AttachmentStore|stageToWorktree|collectReferencedShas|harvestReferences|attachmentBlobRoot|/attachment/|filePartsFromStagedReferences|readReference" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 specs/records/2026-06 -g "*.ts" -g "*.md"`; `rg -n "BuildEvidencePack|buildEvidencePack|build_session_contract|build_attempt_outcome|beginBuildAttempt|composeBuildEvidencePack|targetEvidenceForBuild|previous_output|rendered_output" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 specs/records/2026-06 -g "*.ts" -g "*.md"`; `rg -n "routeRequiresProjectDirectory|TASK_RECORD_READ_ROUTE|requireTaskInCurrentProject|requireGoalRunInCurrentProject|runtime-id|runtimePath|taskRoot|sessionRoot|goalWorktree" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 specs/records/2026-06 -g "*.ts" -g "*.md"`. |
| First independent analysis | Carson confirmed the documented product boundary: one directory may hold many user-visible projects/Missions/tasks, but not multiple backend `project_id` namespaces for the same worktree. Arendt confirmed `stageToWorktree` is correctly strict and the missing boundary is an attempt-scoped durable Build input owner. Helmholtz confirmed runtime roots and attachment blobs are physically directory-level while task/session paths are mostly scoped, so same-directory multi-`project_id` cannot be fully isolated. |
| Second independent review | Wegener rejected implementing a new `user_project` table for this failure chain and required using existing Mission/task grouping unless product requirements exceed it. Heisenberg and Wegener both rejected parallel `build_input_evidence` and `build_session_contract` authorities. Heisenberg required `artifact_file_ref` rather than attachment-only ownership and required missing blobs to fail during dispatch evidence composition. Socrates required a fuller `project_id` surface table, linked-worktree wording, cache handling, current duplicate-project preflights, and explicit Build callsite replacements. |

## Problem Statement

The failed-goal sample has two separable layers:

1. Direct terminal failures:
   - Build evidence staging or provider replay saw `/attachment/<projectID>/<sha>` refs whose `projectID` belonged to another backend namespace.
   - Build evidence staging or provider replay saw attachment URLs that resolved to `.opencorvus/r/b/a/<sha>.<ext>` paths that no longer existed.
   - One failure was an independent provider `hexin` HTTP 401.
2. Deeper design issue:
   - the system treats `project_id` as a backend storage/runtime namespace, but the physical runtime root and attachment blob pool live under one canonical project worktree/common Git identity;
   - persisted JSON/text rows can embed `/attachment/<projectID>/...`, making `project_id` a durable data identity in addition to a foreign key column;
   - Build input evidence is a non-durable projection without one dispatch-owned contract section that proves every consumed ref belongs to the same task/project/goal run and is readable before provider replay.

The unsupported claim that goal names such as `source row` directly caused the failures is not part of this causal chain. Names are only classification clues unless linked to terminal errors, tool inputs, artifacts, or code paths.

## Current Evidence

| Surface | Evidence | Implication |
| --- | --- | --- |
| Product/project terminology | `AGENTS.md` rule 41 says one directory can carry many user-visible projects/Missions/tasks, while `project_id` is a backend storage/runtime namespace. | Do not model user-visible multiple projects by manufacturing multiple backend `project_id` rows for one worktree. |
| Backend namespace ownership | `project.ts` migrates every table with a `project_id` column during exact-worktree convergence; explicit surfaces include engine, session, permission, workspace, memory, control, quick note, scheduler, and full-text search rows. | The backend namespace is much wider than task/session rows. Any namespace split can affect task history, memory, scheduled jobs, permissions, and runtime evidence. |
| Runtime paths | `ProjectRuntimePaths.projectRuntimeRoot(projectDir)` is `<projectDir>/.opencorvus/r`; task/session/worktree paths add task/session/run fanout; `attachmentBlobRoot(projectDir)` is `.opencorvus/r/b/a`. | Task/session runtime is partly isolated, but the blob store is physically directory-level. |
| Project-keyed runtime caches | Snapshot cache, session diff cache, ownership root, mission root, and project git lock also live below one `.opencorvus/r`. Some cache paths include `projectID`, but the parent root is still the same physical runtime tree. | Duplicate backend project rows for one worktree can leave stale cache directories keyed by retired ids. Those caches should be rebuilt or explicitly discarded after convergence, not treated as independent task evidence. |
| Linked worktree behavior | Linked Git worktrees share the canonical project identity while the active linked path is a sandbox/worktree execution directory. | "One physical worktree" must be read as one canonical project worktree/common Git identity, not one backend namespace per linked Git worktree. |
| Attachment storage | `AttachmentStore.write(projectID, ...)` resolves bytes through `Project.get(projectID).worktree` and returns `/attachment/<projectID>/<sha>.<ext>`. | If two backend project rows point to the same canonical worktree, URL identity and physical storage identity diverge. |
| Duplicate worktree convergence | The exact-worktree convergence repair aborts when embedded `/attachment/<duplicateID>/...` refs exist, and preflights known unique conflicts such as `permission.project_id` and `engine_task(project_id, request_id)`. | Embedded attachment URLs are a second durable project identity carrier that cannot be bulk-updated by moving direct `project_id` columns. Future project-scoped unique constraints must join this preflight list. |
| Staging strictness | `AttachmentStore.stageToWorktree(projectID, ...)` rejects refs whose URL project differs from the expected project. | Cross-project attachment failure is a correct data-integrity error, not something to tolerate or repair by copying. |
| Build evidence | `BuildEvidencePack` is currently a typed in-memory projection; `build_session_contract` and `build_attempt_outcome` do not record per-input file ownership, staged paths, source artifact IDs, or sha validation. | Failed attempts cannot be audited from the durable Build dispatch artifact; retries can replay stale session refs. |

## Consensus Design

### 1. Canonical Storage Namespace

One canonical project worktree/common Git identity must resolve to exactly one backend storage namespace. The current implementation name can remain `project_id` for the immediate repair, but the architecture should treat it as a storage namespace, not as the user-visible project entity.

Required properties:

- `ProjectTable.worktree` exact duplicates remain converged or rejected through the existing marker/filesystem identity logic.
- No route, task, retry path, or UI grouping path may create a second backend `project_id` for the same canonical project worktree to represent user-visible project separation.
- `.git/opencorvus` remains a durable namespace signal for the canonical project.
- Ambiguous duplicate backend namespaces remain visible errors; do not add fallback global task lookup, cross-project search, or raw `worktree` unique-index shortcuts that bypass the existing marker/filesystem convergence rules.
- Duplicate-project convergence must continue to hard-preflight embedded `/attachment/<duplicateID>/...` refs and known unique constraints. Any new project-scoped unique constraint must be added to the convergence preflight.

### 2. Current User-Visible Grouping

Current implementation scope uses existing Mission/task grouping. Do not add a new `user_project` table for this failure chain.

Current product facts:

- Mission is already a persisted product surface through `session.kind = "mission"` plus `metadata.mission`.
- Tasks can be grouped under Mission metadata.
- Mission lookup and creation already include project/directory/mission identity.

If future product requirements demand multiple visible projects in one directory with independent titles, settings, permissions, or archive state beyond Mission/task grouping, that requires a separate product request and design record. That future design must not add a second storage/worktree source such as `user_project.directory` that competes with `project.worktree` or `session.directory`; it must define any display/default-cwd field as product metadata with explicit validation.

### 3. Task/Session/Attempt Runtime Ownership

Within one backend namespace, isolation must be explicit at the task/session/attempt layer:

- task-owned runtime material stays under `.opencorvus/r/t/<task-key>/...`;
- session-owned traces/tool output stay under `.opencorvus/r/s/<task-session-key>/...`;
- goal/build worktrees stay under `.opencorvus/r/w/<goal-run-key>/worktree`;
- mission runtime under `.opencorvus/r/m/<mission-key>` is a mission surface, not a storage namespace;
- project git lock, ownership roots, snapshot/session-diff caches, and the raw blob pool are shared storage infrastructure, not task evidence ownership.

If a future feature requires filesystem-level hard isolation between tasks, it must allocate separate physical worktrees/runtime roots. It must not claim hard isolation while sharing the same canonical worktree runtime root and blob pool.

### 4. Build Dispatch Contract As Single Source

Do not introduce a parallel durable `build_input_evidence` artifact. The single durable Build dispatch authority is `build_session_contract`, extended with an immutable `input_evidence` section.

Reason:

- `build_session_contract` is already the Build session durable anchor used by board projection, compaction, and redispatch recovery.
- Adding a second artifact carrying overlapping entries would violate the single-source rule.
- `beginBuildAttempt` already accepts `extraArtifacts`, so the extended contract can be written in the same transaction as the goal run attempt.

Required dispatch order:

1. Before calling `BuildAgent.run`, compose an immutable input object from task-owned sources.
2. Validate each evidence entry in this order:
   - task project ownership;
   - canonical metadata exists and matches the URL/file ref;
   - bytes are readable;
   - sha matches the declared content identity;
   - role/source/intent are recorded.
3. Pass the validated object into `BuildAgent.run`.
4. When `BuildAgent.run` creates the Build session and invokes `onSessionCreated`, `beginBuildAttempt.extraArtifacts` writes the extended `build_session_contract` with `input_evidence` in the same transaction as the running `goal_run_attempt`.
5. BuildAgent stages from the same validated object/contract section and never recomputes evidence ownership from ambient project state.

Minimum `build_session_contract.input_evidence` payload:

```text
input_evidence:
  version
  project_id
  task_id
  goal_id
  goal_run_id
  session_id
  entries:
    - role
      project_id
      sha
      mime
      size
      filename
      source_artifact_id?
      source_decision_id?
      source_task_id?
      legacy_attachment_url?
      artifact_file_ref_id?
      staged_rel_path?
      sha_verified_at
```

For Phase 1, entries may carry `legacy_attachment_url` only as a validated legacy byte address. It is not semantic ownership. When `artifact_file_ref` exists, `artifact_file_ref_id` becomes the single entry reference and `legacy_attachment_url` becomes a display/projection field only.

### 5. Same-Session Retry Boundary

Same-session retry is bounded by Build session, not by logical goal run count.

Rules:

- A retry that reuses an existing Build session reuses that session's original `build_session_contract.input_evidence` and must not add new model file parts.
- A fresh Build session or redispatch creates a new extended `build_session_contract` with a new `input_evidence` section.
- Replay repair may rematerialize only same-project, same-sha evidence from recorded staged files or explicit artifact paths. Foreign project or missing-source evidence is corrupt evidence and must fail visibly before provider replay.

### 6. Future File Reference Authority

The long-term durable file owner should be a generic `artifact_file_ref`, not an attachment-only `attachment_ref`.

Reason:

- Build, Visual Quality Assurance (QA), Browser Preview, Frontend Design, and Integrity consume more than user-uploaded AttachmentStore blobs.
- Existing design resource manifests already distinguish canonical refs, artifact paths, origin, kind, and intent.
- A generic file ref can represent attachment blobs, runtime artifact paths, staged files, visual evidence images, and diagnostics without creating multiple ownership models.

Future model direction:

```text
artifact_file_ref
  id
  project_id
  task_id
  session_id?
  goal_id?
  goal_run_id?
  artifact_id?
  storage_kind
  storage_key
  sha
  mime
  size
  role
  source
  intent
  filename
  created_at
```

Phase 1 does not require adding this table. Before Phase 2 implementation, write a separate detailed design and choose `artifact_file_ref` as the single new ownership model. Do not add parallel `attachment_blob`/`attachment_ref` tables for this same purpose.

Garbage collection (GC) direction:

- Current GC may keep regex harvesting for legacy embedded `/attachment/...` refs.
- New Build dispatch evidence and future artifacts must be retained by explicit file refs.
- Once `artifact_file_ref` is implemented, GC live-set authority moves to file-ref rows; regex harvesting becomes legacy audit/report only.

### 7. Route and API Ownership

Keep the existing direction:

- Task record reads should be task-owned when the task row itself proves the project and directory.
- Writes and runtime mutations that affect the selected worktree must still prove the current backend namespace and reject foreign tasks.
- Attachment byte routes can carry `projectID` in the path, but semantic consumers must not infer task ownership from the route URL alone.

### 8. Queue and Parallelism Boundary

Same-directory parallel tasks are valid only to the extent their mutation surfaces are isolated:

- evidence collection, planning, research, and read-only analysis can run concurrently under one backend namespace;
- direct writes to the current source worktree require a worktree mutation owner;
- managed Build worktrees may run in parallel because their edit roots are goal-run scoped;
- shared directory-level caches/blob pool require DB ownership and GC correctness, not multiple backend namespaces.

This is a resource ownership boundary, not a gate that teaches the language model a route. The language model still decides workflow steps; the system persists and validates data ownership.

## Current Build Callsite Decisions

| Callsite | Current issue | Decision |
| --- | --- | --- |
| `orchestrator/tools.ts::composeBuildEvidencePack` | Builds an in-memory pack from task fields and optional previous output without a durable input owner. | Keep the role projection, but make it feed the validated `build_session_contract.input_evidence` section before BuildAgent starts. |
| `orchestrator/tools.ts::targetEvidenceForBuild` | Can pass task attachments/design resource refs without uniform project/readability/sha validation. | Validate each entry against `task.project_id`, canonical metadata, readable bytes, and sha before contract write. |
| `orchestrator/tools.ts::loadPreviousRenderedOutputEvidence` | Reads task-level latest rendered output and checks resolvability, but not full owner/sha/goal-run provenance. | Treat as `previous_output` only after task project, bytes, sha, and available goal/run provenance are recorded. If provenance is absent, record it as task-scoped repair context, not goal-scoped fact. |
| `orchestrator/tools.ts` Visual QA diagnostic attachment writes | Some writes use ambient `Instance.project.id`. | Use `task.project_id` when the diagnostic belongs to a task. Ambient project is not an evidence owner. |
| `build/agent.ts::BuildAgent.run` staging | Staging and retry repair currently pass `Instance.project.id` in paths that are task-owned. | Use `input.task.project_id`; reject active-project/task-project mismatch during evidence composition before provider replay. |
| `build/agent.ts` same-session retry | Existing-session retry ignores fresh evidence packs and repairs old session parts. | Preserve no-resend semantics, but bind repair to the existing session's original `build_session_contract.input_evidence`. |

## Expanded Impact Surface Investigation

Additional whole-repository searches for the expanded investigation:

```text
rg -n "project_id: text|project_id\)|queued_by_project_id|ProjectTable\.id|references\(\(\) => ProjectTable\.id" packages/opencorvus/src -g "*.ts"
rg -n "AttachmentStore\.(write|writeFromPath|stageToWorktree|read|readReference)|/attachment/|collectReferencedShas|harvestReferences|filePartsFromStagedReferences" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
rg -n "Instance\.project\.id|task\.project_id|input\.task\.project_id|Project\.get\(task\.project_id|projectID: task\.project_id|write\(Instance\.project\.id|writeFromPath\(Instance\.project\.id" packages/opencorvus/src packages/overlay/src -g "*.ts" -g "*.tsx"
rg -n "routeRequiresProjectDirectory|TASK_RECORD_READ_ROUTE|x-opencorvus-directory|withDirectoryQuery|requireRouteTaskInCurrentProject|provideTaskProjectForConversationRead|currentDirectory|selectedDirectory" packages/opencorvus/src packages/overlay/src packages/sdk/js/src packages/transport-protocol/src -g "*.ts" -g "*.tsx"
```

| Surface | Evidence | Impact on the consensus design |
| --- | --- | --- |
| Database namespace breadth | `project_id` appears across engine tasks, sessions, memory files/chunks, workspace rows, scheduler cron/event jobs, control messages, quick notes, permission, and related indexes. `project.ts::projectIDTables` migrates all direct `project_id` columns during exact-worktree convergence. | The affected surface is not limited to Build, task, or session rows. Any implementation that creates multiple backend `project_id` rows for one canonical worktree risks splitting history, memory, scheduled work, permissions, and runtime evidence. |
| Unique project-scoped constraints | `project.ts::assertNoUniqueProjectConstraintConflict` currently preflights multi-owner `permission` rows and duplicate `engine_task(project_id, request_id)` ownership before merging duplicate exact-worktree rows. | Future project-scoped unique constraints must be added to convergence preflight. A raw unique index on `project.worktree` would be an incomplete fix because it would not resolve existing row conflicts or embedded references. |
| Embedded attachment identity carriers | `AttachmentStore.collectReferencedShas` scans session parts, task attachments, system artifacts, decision logs, artifact payloads, interaction requests, progress snapshots, and channel binding payloads for `/attachment/<projectID>/...`. `project.ts::assertNoEmbeddedProjectIDReferences` blocks convergence when duplicate project IDs are embedded in text columns. | `/attachment/<projectID>/...` is a durable identity carrier outside direct foreign keys. Phase 1 must not rewrite or tolerate foreign refs; Phase 2 needs a real `artifact_file_ref` authority so regex harvesting becomes legacy audit, not the main ownership model. |
| Runtime filesystem sharing | `.opencorvus/r` is the shared project runtime root. Task/session/worktree paths fan out below it, but attachment blobs, project git lock, ownership roots, snapshot cache, session diff cache, and mission runtime still share the same physical runtime tree. | Same-directory tasks can be isolated by task/session/attempt roots only. They cannot claim complete Database and runtime isolation unless the product allocates separate physical worktrees/runtime roots. Project-keyed cache directories for retired project IDs must be rebuilt or discarded, not treated as evidence. |
| Build staging and retry repair | `build/agent.ts` checks existing Build session ownership against `input.task.project_id`, but still stages evidence and repairs retry file parts with `Instance.project.id`. | The fix must replace ambient project ownership in Build staging and retry repair with the task/session evidence owner. The failure should occur during evidence composition, before provider replay or byte writes. |
| Session prompt byte materialization | `session/prompt/parts.ts` writes Model Context Protocol (MCP) blobs, `data:` file parts, and `file://` paths through `AttachmentStore.write` or `writeFromPath` using ambient `Instance.project.id`. Build staging comments explicitly rely on this path to rematerialize provider-bound file parts. | This is newly confirmed broader impact. Build input correctness is not sealed by changing `stageToWorktree` alone. Phase 1 must either run Build session prompt materialization under the task project or pass an explicit evidence/session project owner into SessionPrompt, with tests proving mismatched active project cannot write bytes into the wrong namespace. |
| Provider replay | `session/message.ts` and provider transforms read attachment refs by the project ID embedded in the URL. Missing blobs or wrong project IDs surface as provider replay failures when evidence is not validated earlier. | Provider replay should only see refs that already passed contract validation. The dispatch contract must prove readability and sha before model-call construction. |
| Build contract readers | `build_session_contract` already acts as the durable Build session anchor, while `build_attempt_outcome` records result-side facts. | `input_evidence` belongs in `build_session_contract`, not a parallel artifact. Board projection, compaction, redispatch recovery, and any contract summary readers must read the same section if they expose Build inputs. |
| Application Programming Interface (API), Software Development Kit (SDK), and overlay route policy | `routeRequiresProjectDirectory` is shared by server, SDK, and overlay. Task record reads bypass directory; writes and runtime mutations remain project-scoped. Orchestrator has explicit current-project checks plus task-project provisioning for conversation reads. | No global task lookup or directory bypass should be added for writes. If route policy changes later, OpenAPI, generated SDK, and overlay request tests must change together. |
| Mission grouping | Mission identity currently uses `SessionTable.project_id`, `SessionTable.directory`, `session.kind = "mission"`, and `metadata.mission.id`; `ensureMissionSession` locks on `project_id:directory:missionID`. | A new user-visible project layer would affect Mission list/query/wake semantics, not just Build. That remains out of scope for this failure chain; current repair should keep Mission/task grouping. |
| Scheduler and queue | Task queue pending and claim queries filter queued sessions by current `Instance.project.id`. Engine queue payloads can carry `queued_by_project_id` and `queued_by_instance_directory`. | Splitting backend namespaces in one directory can orphan or hide queued/running work. Redispatch and wake paths must resolve the owning task/session project, not infer ownership from an arbitrary active directory context. |
| Active Vite log | `.scratch/worktree-clean-vite.out.log` only shows Vite Hot Module Replacement (HMR), page reload, and one server restart caused by `vite.config.ts` change. | This log is not direct evidence for failed goals, cross-project refs, missing blobs, or provider 401. It should not be used as causal proof. |
| Provider authorization | The earlier failed-goal evidence included one independent `hexin` HTTP 401. | Namespace and Build evidence fixes will not repair provider credentials or authorization. That failure remains a separate provider/auth surface. |

Additional acceptance tests required by the expanded impact:

- Build dispatch with active project different from `task.project_id` fails during evidence contract composition before `AttachmentStore.write`, `writeFromPath`, `stageToWorktree`, provider replay, or Build session prompt materialization can persist bytes in the wrong namespace.
- `SessionPrompt` materialization of MCP blobs, `data:` file parts, and `file://` parts must use an explicit session/task project owner or prove it is running inside the task project context.
- `build_session_contract.input_evidence` must retain referenced bytes for Garbage Collection (GC) while the owning contract is live.
- Duplicate exact-worktree convergence tests must keep embedded `/attachment/<duplicateID>/...` refs as a hard conflict and must cover any newly added project-scoped unique constraints.
- If any route directory policy changes, server route tests, generated SDK injection behavior, and overlay request construction must be verified together.
- If a future user-visible project layer is designed, Mission list/query/wake, queue wake, task search, and runtime fanout must be covered in that separate design.

## Implementation Phases

### Phase 1: Seal The Current Failure Chain

- Extend `build_session_contract` with `input_evidence` and treat it as the single Build dispatch manifest.
- Compose and validate Build input evidence before BuildAgent/provider replay:
  - foreign-project target references fail before staging;
  - missing blobs fail as corrupt Build input before provider replay;
  - sha mismatch fails before contract write.
- Replace task-owned ambient `Instance.project.id` usage in Build evidence materialization/staging/repair with `task.project_id`.
- Replace or explicitly bind SessionPrompt byte materialization for Build-bound MCP blobs, `data:` file parts, and `file://` parts so it cannot use the wrong ambient project.
- Ensure the extended `build_session_contract` is written through `beginBuildAttempt.extraArtifacts` in the same transaction as the running attempt.
- Keep `AttachmentStore.stageToWorktree` strict.
- Add focused tests:
  - foreign-project target reference rejected before staging;
  - missing blob rejected before provider replay;
  - sha mismatch rejected before contract write;
  - active-project/task-project mismatch rejected before any Build-bound byte materialization;
  - SessionPrompt Build-bound MCP/blob/file parts use the task/session project owner;
  - same Build session retry reuses original input evidence and does not resend images;
  - fresh Build session creates a new contract input section;
  - contract-held evidence is retained by GC while the owning contract is live.

### Phase 2: Normalize File Ownership

- Write a separate detailed design for `artifact_file_ref`.
- Migrate new task/session/artifact/Build evidence to write file refs instead of naked URLs as semantic ownership.
- Convert GC live-set authority to `artifact_file_ref`.
- Keep regex harvesting only as a legacy embedded-ref audit.
- Tests must prove deleting an unrelated task cannot delete bytes retained by another task/file ref sharing the same sha.

### Phase 3: Product Grouping Only If Needed

- Do not implement `user_project` for the current failure chain.
- Continue using Mission/task grouping for current same-directory visible work.
- If future product requirements need a separate user-visible project layer, create a new design that covers Mission/session/task query keys, route parameters, list/filter semantics, runtime fanout, and display/default-cwd metadata without competing with `project.worktree`.

### Phase 4: Current Architecture Update

After implementation and verification, update `specs/current/architecture/02-data.md` and `10-worktree-lifecycle.md` to make the storage namespace, Build contract input evidence, and file-ref authority current architecture.

## Non-Goals

- Do not split one canonical project worktree/common Git identity into several backend `project_id` rows.
- Do not copy foreign attachments into the current project as a repair.
- Do not rewrite embedded `/attachment/<projectID>/...` strings blindly.
- Do not add route-level global task fallback when current project ownership rejects an ID.
- Do not reset the DB to hide existing corrupted evidence.
- Do not turn Build evidence validation into a prompt/gate mechanism; it is a data integrity boundary.
- Do not implement a new visible-project table for this failure chain.
- Do not add `attachment_blob`/`attachment_ref` alongside `artifact_file_ref` for the same ownership problem.

## Independent Review Resolution

| Review finding | Resolution in this revision |
| --- | --- |
| `user_project` is unnecessary and could create directory/worktree dual-source semantics. | Removed from current implementation. Kept only as future product design if Mission/task grouping is insufficient. |
| `build_input_evidence` and `build_session_contract` would be dual sources. | Chose `build_session_contract.input_evidence` as the single durable Build dispatch manifest. |
| Draft timing around `beginBuildAttempt` was wrong. | Revised to compose/validate before BuildAgent starts, then write the extended contract through `beginBuildAttempt.extraArtifacts` when the Build session exists. |
| `attachment_ref` was too narrow. | Replaced long-term model with generic `artifact_file_ref` and made it Phase 2, not Phase 1. |
| Same-session retry was ambiguous. | Defined retry by Build session: reused session reuses original input evidence; fresh session gets a new contract. |
| DB/runtime surfaces were incomplete. | Added backend namespace, cache, linked-worktree, duplicate preflight, and Build callsite tables. |

## Verification

Draft validation after integrating independent review:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000
```
