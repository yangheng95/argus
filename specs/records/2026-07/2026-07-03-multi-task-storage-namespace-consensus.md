# Multi-Task Storage Namespace Consensus

Date: 2026-07-03
Status: Phase 1 implemented through documentation update; end-to-end reproduction pending

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
| External prior art check | Read official docs for [OpenHands Docker Sandbox](https://docs.openhands.dev/sdk/guides/agent-server/docker-sandbox), [OpenHands GUI workspace mounting](https://docs.openhands.dev/openhands/usage/cli/gui-server), [GitHub Codespaces isolation](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces), [Claude Code parallel sessions with worktrees](https://code.claude.com/docs/en/common-workflows), [Git worktree](https://git-scm.com/docs/git-worktree), [SWE-agent output trajectories](https://swe-agent.com/latest/usage/trajectories/), [SWE-agent command-line environment examples](https://swe-agent.com/latest/usage/cl_tutorial/), [GitLab job artifacts](https://docs.gitlab.com/ci/jobs/job_artifacts/), [GitLab CI/CD architecture notes](https://docs.gitlab.com/development/cicd/), [MLflow artifact stores](https://mlflow.org/docs/latest/self-hosting/architecture/artifact-store/), [Bazel remote caching](https://bazel.build/remote/caching), [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), and [Temporal Workflow Id / Run Id](https://docs.temporal.io/workflow-execution/workflowid-runid). |

## Implementation Status

Phase 1 is implemented in code and current architecture docs:

- `build_session_contract.payload.input_evidence` is the single durable Build input manifest.
- Build dispatch composes and validates evidence before provider replay; foreign refs, missing blobs, and sha mismatch fail before contract/provider use.
- Build staging, same-session retry repair, and Build-bound `SessionPrompt` byte materialization use the task/session manifest owner instead of ambient `Instance.project.id`.
- Same-session retry reuses the original manifest and does not resend fresh file parts; fresh Build sessions write a new manifest.
- GC retains blobs referenced only through a live `build_session_contract.input_evidence`.
- Board and compaction projections keep Build inputs single-source by carrying only contract locators.
- Fresh Build dispatch rejects active-project/task-project mismatch before creating a Build child session, staging evidence, or calling a provider.

Goal 10 still remains: run the end-to-end failure reproduction bundle listed below before calling the entire repair complete.

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

## External Prior Art Check

The external systems checked fall into two groups: coding-agent runtime isolation and artifact/run metadata ownership. None of them treat "same checkout plus a different logical project id" as complete isolation.

| Project/system | Observed design | Lesson for OpenCorvus |
| --- | --- | --- |
| OpenHands | The Docker sandbox runs the agent server inside isolated Docker containers and uses a context manager to start, wait for, and clean up the container. The GUI `--mount-cwd` mode explicitly mounts the current directory into `/workspace` and lets the agent read and modify that mounted code. | Real execution isolation is a container/workspace boundary. If the same host directory is mounted read-write, it is shared source state; a second metadata ID does not make it isolated. |
| GitHub Codespaces | Each codespace uses its own Virtual Machine (VM) and isolated network. | Hard runtime isolation means allocating a separate runtime substrate. For us, that maps to separate physical worktrees/runtime roots if the product truly needs hard isolation. |
| Claude Code and Git worktree | Claude Code recommends parallel sessions with worktrees so edits do not collide. Git worktree itself models multiple working trees attached to one repository with metadata that distinguishes each worktree. | Separate checkout/worktree is the edit isolation primitive. A linked worktree can share repository object storage, but it is still a distinct working tree, not a second backend namespace for one checkout. |
| SWE-agent | A run can target a GitHub repo, a local repo copied into a Docker container, or a cloud deployment; its default output is a per-instance trajectory file under `trajectories/`. | Agent evidence is per run/instance. The trace is not inferred from a shared directory alone; it is an explicit run output. |
| GitLab CI artifacts | Artifacts are attached to jobs; metadata lives in the database while large artifact bytes can live in object storage. Downstream jobs fetch artifacts from previous jobs by default or from explicit `dependencies` / `needs:artifacts`. | Blob storage and semantic ownership are separate. Downstream Build must consume a declared job/attempt input manifest, not raw blob URLs discovered from ambient task state. |
| MLflow | Tracking stores run metadata such as params, metrics, and tags in a backend database, while large artifacts live in artifact stores. Artifact access is run-scoped through run IDs or artifact URIs. | `artifact_file_ref` is the right long-term shape: DB metadata owns file meaning; storage URI is only a byte location. |
| Bazel remote cache | The cache has an action cache mapping action hashes to action result metadata, plus a Content Addressable Store (CAS) for output files. Build actions declare inputs and output filenames before cache lookup/upload. | A shared content-addressed blob pool is safe only when paired with immutable action/input metadata. This supports `build_session_contract.input_evidence` as an action manifest, not a secondary convenience record. |
| LangGraph | Checkpointers persist short-term graph state per thread; stores persist long-term cross-thread data. Invocation passes a `thread_id` to select the checkpoint stream. | Task/session state and long-term memory need different authorities. Do not use a long-term project namespace as the owner for short-term Build/session byte materialization. |
| Temporal | A Workflow Execution is identified by Namespace, Workflow ID, and Run ID. Workflow ID is the application identity, while each run has a unique system ID; retries can change run identity, and current Run ID should not drive logical choices. | Goal/task identity, Build session identity, and attempt/run identity must stay distinct. Same-session retry reuses that session's input contract; a fresh Build session creates a new contract. |

Prior art changes the emphasis of the consensus design:

1. The correct architecture is not "one directory can contain many backend project IDs." It is "one canonical source/runtime namespace with explicit task/session/attempt ownership, or allocate a real separate worktree/container/VM when hard isolation is required."
2. `build_session_contract.input_evidence` should be treated as the Build action manifest: declared inputs, owners, roles, hashes, byte locations, and provenance, validated before execution.
3. `AttachmentStore` should remain a byte store. Semantic ownership belongs in durable metadata (`build_session_contract.input_evidence` now, `artifact_file_ref` later).
4. `SessionPrompt` byte materialization must receive the same explicit run/session owner as the Build manifest. Ambient `Instance.project.id` is the pattern that prior-art systems avoid for job/run artifacts.
5. Retry semantics should follow run identity rather than title/goal labels: same Build session keeps the original manifest; new Build session means a new manifest.

## Detailed Goal Execution Plan

Execute these goals in order. Do not merge a later goal before the earlier goal's focused tests pass. Each implementation goal must leave a commit trail before moving to the next behavior surface.

### Goal 0: Recall And Ownership Freeze

Purpose: prevent implementation drift before code changes.

Steps:

1. Re-read this record's `Recall`, `Current Evidence`, `Expanded Impact Surface Investigation`, and `External Prior Art Check`.
2. Run the current whole-repository greps for `build_session_contract`, `BuildEvidencePack`, `AttachmentStore.write`, `writeFromPath`, `stageToWorktree`, `SessionPrompt`, `beginBuildAttempt`, and `collectReferencedShas`.
3. Record any newly discovered callsite in this file before editing code.
4. Confirm the worktree has unrelated changes isolated from this repair.

Acceptance:

- The implementation owner can list every affected callsite and whether it is in scope for this repair.
- No code file has been edited before the Recall and grep evidence are refreshed.

Do not:

- Start with `BuildAgent.run` edits from memory.
- Add a new artifact kind, table, or route before the callsite map is current.

### Goal 1: Contract Schema And Validation Surface

Purpose: define one typed Build input evidence contract before callers write it.

Primary files:

- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- a focused new or existing test file under `packages/opencorvus/test/build-agent` or `packages/opencorvus/test/orchestrator`

Steps:

1. Introduce a typed value for `build_session_contract.input_evidence` with fields listed in this record.
2. Add a pure validator/composer that accepts task-owned candidate evidence and returns an immutable manifest.
3. Validate owner project, attachment metadata, readable bytes, sha, role, source, and intent before any Build session prompt or provider replay can use the entries.
4. Make validation errors name the offending role and ref.

Tests first:

- foreign-project ref is rejected with the expected project and actual project in the error;
- missing blob is rejected before provider replay;
- metadata sha mismatch is rejected before contract creation.

Acceptance:

- The validator is callable without starting a Build session.
- The validator has no fallback copy path and never rewrites foreign attachment URLs.

Do not:

- Create a parallel `build_input_evidence` artifact.
- Treat `legacy_attachment_url` as semantic ownership.

### Goal 2: Orchestrator Dispatch Uses The Manifest

Purpose: make Build dispatch create the single input manifest before `BuildAgent.run`.

Primary files:

- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`

Steps:

1. Change `composeBuildEvidencePack` / `targetEvidenceForBuild` / `loadPreviousRenderedOutputEvidence` flow so their output feeds the manifest composer.
2. Reject invalid evidence before calling `BuildAgent.run`.
3. Pass the validated manifest into `BuildAgent.run` through the existing context or a precise typed input.
4. Extend `buildSessionContractArtifactForAttempt` so `build_session_contract.payload.input_evidence` is written through `beginBuildAttempt.extraArtifacts`.
5. Include the input evidence digest in the existing contract digest calculation.

Tests first:

- `BuildAgent.run` spy is not called when manifest validation fails;
- `build_session_contract` payload contains `input_evidence` when dispatch succeeds;
- direct task-level Build and goal Build both use the same validation path.

Acceptance:

- `build_session_contract` is the only durable Build input authority.
- Dispatch failure is visible as a Build/orchestrator error, not a downstream provider error.

Do not:

- Persist a half contract before the Build session exists.
- Add a route-level global task lookup to find evidence.

### Goal 3: BuildAgent Stages From The Manifest Owner

Purpose: remove ambient project ownership from Build evidence staging.

Primary files:

- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`

Steps:

1. Replace `AttachmentStore.stageToWorktree(Instance.project.id, ...)` with the manifest/task owner project.
2. Ensure `buildEvidenceEntries` cannot reintroduce entries that were not validated into the manifest.
3. Carry staged relative paths back into the manifest or contract projection if staging is the source for provider-bound file parts.
4. Keep `AttachmentStore.stageToWorktree` strict.

Tests first:

- active `Instance.project.id` differs from `input.task.project_id`; staging uses `input.task.project_id`;
- foreign evidence still fails before staging;
- staged list renders only validated entries.

Acceptance:

- No Build-owned staging call in `build/agent.ts` uses ambient `Instance.project.id`.
- Errors still surface as hard failures.

Do not:

- Copy foreign blobs into the task project.
- Catch staging errors and continue without evidence.

### Goal 4: SessionPrompt Byte Materialization Owner

Purpose: ensure provider-bound byte writes use the Build/session owner, not ambient project context.

Primary files:

- `packages/opencorvus/src/session/prompt/parts.ts`
- `packages/opencorvus/src/session/prompt/schema.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`
- `packages/opencorvus/test/session/prompt*.test.ts`
- `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`

Steps:

1. Add an explicit byte materialization owner to `SessionPrompt.PromptInput` or session runtime contract.
2. For Build sessions, populate that owner from `task.project_id` / the validated Build manifest.
3. Use that owner in MCP blob, `data:` file part, and binary `file://` materialization paths.
4. Preserve ordinary non-Build session behavior by requiring their existing session project as the explicit owner at the call boundary.
5. Ensure queued prompt replay serializes and restores the owner, rather than recomputing it from the active Instance.

Tests first:

- Build-bound MCP blob writes `/attachment/<task.project_id>/...` even when active Instance differs;
- Build-bound `data:` file writes `/attachment/<task.project_id>/...`;
- Build-bound binary `file://` writes `/attachment/<task.project_id>/...`;
- queued prompt replay preserves the original owner.

Acceptance:

- `session/prompt/parts.ts` has no Build-relevant `AttachmentStore.write(Instance.project.id, ...)` or `writeFromPath(Instance.project.id, ...)`.
- Missing owner is a structural error for Build-bound prompts.

Do not:

- Infer owner from attachment URL.
- Add a "try task project, else Instance project" fallback.

### Goal 5: Same-Session Retry Reuses The Original Manifest

Purpose: make retry semantics match Build session identity.

Primary files:

- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`

Steps:

1. When `existingSessionID` is present, load the original `build_session_contract.input_evidence` for that session.
2. Reject retry if the existing session has no contract or the contract task/project/session does not match.
3. Repair staged file parts only from the original manifest/staged paths.
4. Ensure a fresh Build session creates a new manifest.

Tests first:

- same-session retry does not add fresh model file parts;
- same-session retry fails if original manifest is absent;
- fresh session writes a new manifest with a different session id;
- retry repair uses the manifest owner, not ambient project.

Acceptance:

- Retry behavior is derived from Build session identity, not goal title, current task attachments, or current active project.

Do not:

- Re-run evidence discovery for a reused Build session.
- Silently continue when a previous contract is missing.

### Goal 6: Garbage Collection Keeps Contract-Held Evidence

Purpose: prevent manifest-owned evidence from being swept while the Build contract is live.

Primary files:

- `packages/opencorvus/src/storage/attachment-store.ts`
- `packages/opencorvus/test/storage/attachment-store-sweep.test.ts`

Steps:

1. Confirm `collectReferencedShas` sees `build_session_contract.payload.input_evidence.legacy_attachment_url`.
2. Add a test with a live Build contract whose only reference to the blob is inside `input_evidence`.
3. Keep regex harvesting as legacy retention for Phase 1.
4. Document that Phase 2 replaces this with `artifact_file_ref`.

Tests first:

- sweep retains a blob referenced only by `build_session_contract.input_evidence`;
- sweep does not retain a blob with no DB reference.

Acceptance:

- Build input evidence does not disappear between dispatch and retry.

Do not:

- Add a second GC live-set source for the same Phase 1 attachment URL contract.

### Goal 7: Projection Readers Stay Single-Source

Purpose: keep board, compaction, and redispatch readers aligned with the extended contract.

Primary files:

- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/compaction-handoff.ts`
- tests covering contract summaries/projections

Steps:

1. Audit every `build_session_contract` reader.
2. If a reader exposes Build input summaries, read `payload.input_evidence` from the same contract.
3. If a reader does not expose Build inputs, leave it unchanged and document why.
4. Ensure compaction handoff does not invent a second Build evidence summary.

Tests first:

- board/compaction readers tolerate the new contract field;
- any surfaced Build input summary uses the contract field, not recomputed task attachments.

Acceptance:

- No projection layer recomputes Build evidence ownership from current task state.

Do not:

- Add duplicate summary artifacts to make UI rendering easier.

### Goal 8: Project/Route Boundary Regression Coverage

Purpose: ensure the repair does not become a route fallback or project lookup bypass.

Primary files:

- `packages/transport-protocol/src/index.ts`
- `packages/sdk/js/src/client.ts`
- `packages/overlay/src/services/api.ts`
- existing server route tests for task/orchestrator reads and writes

Steps:

1. Confirm no route policy change is required for the Phase 1 fix.
2. Add or preserve regression tests proving task record reads may bypass directory while writes remain project-scoped.
3. Add a Build dispatch test where active project and task project differ, proving dispatch rejects or re-provides the task project before evidence materialization.

Acceptance:

- No global task fallback is introduced.
- SDK and overlay directory injection behavior remain unchanged unless a separate route design is written.

Do not:

- Modify `routeRequiresProjectDirectory` to hide Build ownership bugs.

### Goal 9: Documentation And Current Architecture Update

Purpose: make the implemented behavior the current architecture after tests pass.

Primary files:

- `specs/current/architecture/02-data.md`
- `specs/current/architecture/10-worktree-lifecycle.md`
- `specs/records/2026-07/README.md`
- this record

Steps:

1. After implementation tests pass, update current architecture docs with storage namespace, Build manifest, retry, and byte materialization owner behavior.
2. Mark this record's implementation status and final verification commands.
3. Run docs health tests.

Verification:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000
```

Acceptance:

- Current docs do not describe this as a future plan after implementation lands.

Do not:

- Update current architecture before code behavior exists.

### Goal 10: End-To-End Failure Reproduction

Purpose: verify the original failure class is actually sealed.

Steps:

1. Create or reuse a fixture that simulates a task with Build evidence refs owned by another project namespace and missing blob refs.
2. Run Build dispatch and assert failure occurs before provider replay.
3. Run a valid Build evidence case and assert the contract is written, staged evidence uses the manifest owner, and provider-bound parts materialize under the same owner.
4. Run same-session retry and fresh-session retry cases.
5. Run final typecheck and focused test suites.

Focused verification commands:

```powershell
bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 120000
bun test packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts --timeout 120000
bun test packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts --timeout 120000
bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts --timeout 120000
bun run --cwd packages/opencorvus typecheck
```

Acceptance:

- Foreign project and missing blob evidence fail before provider replay.
- Valid evidence produces one `build_session_contract.input_evidence` authority.
- Build-bound bytes are written under the manifest/session owner.
- Same-session retry reuses the original manifest.
- Fresh session retry writes a new manifest.

Do not:

- Call the repair complete after mocked contract-only tests.
- Use a provider 401 as evidence that namespace repair failed; provider auth remains separate.

## Implementation Phases

### Phase 1: Seal The Current Failure Chain

- Status: implemented.
- Extended `build_session_contract` with `input_evidence` and treats it as the single Build dispatch manifest.
- Composes and validates Build input evidence before BuildAgent/provider replay:
  - foreign-project target references fail before staging;
  - missing blobs fail as corrupt Build input before provider replay;
  - sha mismatch fails before contract write.
- Replaced task-owned ambient `Instance.project.id` usage in Build evidence materialization/staging/repair with `task.project_id`.
- Bound SessionPrompt byte materialization for Build-bound MCP blobs, `data:` file parts, and `file://` parts so it cannot use the wrong ambient project.
- Ensures the extended `build_session_contract` is written through `beginBuildAttempt.extraArtifacts` in the same transaction as the running attempt.
- Keeps `AttachmentStore.stageToWorktree` strict.
- Added focused tests:
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

Status: implemented for `specs/current/architecture/02-data.md` and `10-worktree-lifecycle.md`. They now describe the storage namespace, Build contract input evidence, retry owner, and Phase 2 `artifact_file_ref` direction as current architecture.

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

Phase 1 implementation verification run during execution:

```powershell
bun test packages/opencorvus/test/build-agent/evidence-manifest.test.ts --timeout 120000
bun test packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts --timeout 120000
bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build retry reuses the prior build session by default|goal build session contract records validated input evidence manifest|direct build rejects foreign input evidence" --timeout 120000
bun test packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/session/prompt-parts-model-resolution.test.ts --timeout 120000
bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts --timeout 120000
bun test packages/opencorvus/test/workbench/board.test.ts --timeout 120000
bun test packages/opencorvus/test/session/compaction.test.ts --timeout 120000
bun test packages/transport-protocol/test/contract.test.ts --timeout 120000
bun test packages/overlay/test/api-directory-injection.test.ts --timeout 120000
bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "hydrates transcript from the task project|current-project transcript" --timeout 120000
bun run --cwd packages/opencorvus typecheck
```
