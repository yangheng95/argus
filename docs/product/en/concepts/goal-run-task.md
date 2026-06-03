# Data model: Task / Goal / Plan / Artifact

All engine-domain table definitions are centralized in `packages/opencorvus/src/engine/engine.sql.ts`, with the unified naming prefix `engine_*` (the historical `orchestrator_*` prefix has been fully renamed).

> **Key change (2026-05)**: Phase 6 merged 5 process tables (`engine_run` / `engine_goal_run` / `engine_acceptance` / `engine_evaluation` / `engine_goal_snapshot`) into a **single `engine_artifact` table**, distinguished by the `kind` field. If you came from older docs that treated Run / GoalRun / Evaluation / Acceptance as separate tables, that model is entirely obsolete.

## Entity relationships

```
Task (kind: "workflow" | "build")
 └─ PlanVersion (version 1, 2, ... ; status ∈ {active, superseded})
     ├─ Goal[]                ← deeply decomposed targets
     ├─ Milestone[]           ← acceptance milestones (pending / active / passed / failed)
     ├─ Requirement[]         ← requirement traceability
     └─ PlanNode[]            ← plan steps

Artifact[]   (run / goal_run_attempt / acceptance / verification-evidence / verdict / patch / …)
SpecSnapshot · SpecItem        ← requirements output
InteractionRequest             ← permission / question
ChannelBinding                 ← external channel ↔ task binding
ProgressSnapshot · ExecutorSession ← progress and executor handles
```

The complete list of 13 tables is in [02-data.md](../../../specs/new-arch/02-data.md#engine-domain-13-tables).

## Entity reference

### Task (`engine.sql.ts` · `EngineTaskTable`)

| Field        | Meaning                                                                                                                                              |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`       | `"workflow"` (default; runs the full Task Control Loop) or `"build"` (runs the build agent directly, skipping decomposition / planning / evaluation) |
| `status`     | `queued / active / completed / failed / cancelled`                                                                                                   |
| `priority`   | `critical / high / normal / low`                                                                                                                     |
| `session_id` | Points to the root session                                                                                                                           |

One Task may go through multiple PlanVersions (each replan creates a new version; the old one is set to `superseded`).

### PlanVersion (`EnginePlanVersionTable`)

- `version` — sequential number
- `status` — `active` / `superseded`
- `spec_snapshot_id` — ties to the SpecSnapshot at this version
- New version on every replan / restart_from_stage

### Goal (`EngineGoalTable`)

The smallest unit that can be executed in parallel and verified independently.

Architect decomposition must analyze the requirement surface, implementation ownership, verification ownership, dependencies, and integration risk before submitting the goal graph. A valid workflow includes at least 2 goals; a single all-in-one large goal is invalid because it does not provide reliable independent-execution and independent-acceptance boundaries.

| Field                     | Meaning                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `title` / `objective`     | Name and narrative                                                               |
| `done_definition`         | Acceptance criteria (may include executable commands: `bun run typecheck`, etc.) |
| `owned_paths[]`           | Code paths owned by this goal                                                    |
| `depends_on[]`            | Upstream goals (topological ordering basis)                                      |
| `priority`                | `blocking` or `advisory`                                                         |
| `exports[]` / `imports[]` | Cross-goal data contracts                                                        |

> **The Goal table no longer has a `status` column** — live status is derived by `engine/describe.ts::goalStatusByID` (retired in Phase E, 2026-05-05).
>
> **The Goal table no longer has `workspace_dir` / `workspace_branch` / `workspace_base_ref` / `retry_count` / `cascade_state`** — these have moved to `engine_artifact[kind="goal_run_attempt"].payload` (single source), read via `engine/store.ts::findGoalLatestWorkspace` / `getGoalRetryCount`.

### Milestone (`EngineMilestoneTable`)

Advances through `status ∈ {pending, active, passed, failed}`. Milestones connect the acceptance handoff points between Requirements, Architect, and Acceptance.

### Requirement (`EngineRequirementTable`) / SpecItem (`EngineSpecItemTable`)

Written by the `requirements` agent; serve as traceability anchors for fidelity evaluation.

### Artifact (`EngineArtifactTable` · unified process table)

`kind` determines semantics. Full `EngineArtifactKind` values (`engine.sql.ts:90`):

```
run · goal_run_attempt · acceptance · verification-evidence · evaluation ·
verdict · patch · changed_file · diff · log · report · image · link ·
git_ref · pr · integrity_attempt · prosecutor_attempt ·
acceptance_evidence_manifest · acceptance_surface_manifest ·
acceptance_specialist_review · acceptance_review_threw ·
orchestrator-stream-error
```

**Common `kind` meanings**:

| kind                                                                    | Meaning                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `run`                                                                   | Root node for one task execution attempt (replaces the old `engine_run` table)                         |
| `goal_run_attempt`                                                      | One worktree attempt for a single goal; `payload.workspace_*` is the single source for worktree info   |
| `acceptance`                                                              | One acceptance candidate (replaces the old `engine_acceptance` table)                                      |
| `evaluation` / `verdict`                                                | Evaluation decision (`accepted / rejected / inconclusive`; replaces the old `engine_evaluation` table) |
| `verification-evidence`                                                 | Acceptance check evidence (with `scope = goal_run` / `acceptance`)                                         |
| `patch` / `changed_file` / `diff`                                       | Code change artifacts                                                                                  |
| `acceptance_evidence_manifest` / `surface_manifest` / `specialist_review` | Acceptance-phase artifacts                                                                               |
| `integrity_attempt` / `prosecutor_attempt`                              | Integrity / prosecutor agent output                                                                    |

`inconclusive` verdict means "unable to decide" — not a pass and not a failure; it triggers replan rather than retry.

### InteractionRequest (`EngineInteractionRequestTable`)

`type ∈ {permission, question}`. `permission` is for tool authorization approvals; `question` is for agents actively querying the user.

### ChannelBinding (`EngineChannelBindingTable`)

External channel (platform / channel / thread) ↔ task binding; `ChannelIngress` uses this to route external replies to the corresponding task.

### SpecSnapshot (`EngineSpecSnapshotTable`)

| Field        | Meaning                                    |
| ------------ | ------------------------------------------ |
| `summary`    | One-liner spec                             |
| `content`    | Full spec (Markdown)                       |
| `scope`      | Files / modules in scope                   |
| `evidence[]` | Code evidence chain that grounded the spec |

## Session domain

`packages/opencorvus/src/session/session.sql.ts` contains 5 tables: `session` · `message` · `part` · `todo` · `permission`.

**SessionKind** (fixed at creation time; order as they appear in `session.sql.ts:50-65`):

```
root · orchestrator · assistant · mission · intent-analysis ·
requirements · frontend-design · goal · architect · integrity ·
acceptance · executor · build · evaluator · system
```

**15 kinds** total. `planner` has been removed and is **no longer a valid SessionKind**.

`session.goal_id` field: set when a session belongs to a specific goal (`executor` / `build` sessions); the overlay uses this to nest messages under the corresponding goal card.

## Single writer rule

**No other module may write directly to `engine_*` tables.** The only permitted write paths are:

- `task-api/index.ts` (`EngineService.*` entry points)
- `engine/persist.ts` / `engine/state.ts` / `engine/store.ts`

Read paths are exposed as query helpers in `engine/describe.ts` / `engine/store.ts`.

## Durable state

All state lives in SQLite (default `~/.opencorvus/opencorvus.db`) and persists across process and session boundaries. A crashed task can resume after server restart — the `EngineService.init` serial queue recovery restarts orphaned tasks uniformly (the old `recoverOrphanedTasks` fire-and-forget path no longer exists).

## What's next

- [Architecture overview](./architecture.md)
- [Agentic Loop](./agent-loop.md)
- [Acceptance checks and verdict](../opencorvus/evaluator.md)
- Full data-plane spec: [specs/new-arch/02-data.md](../../../specs/new-arch/02-data.md)
