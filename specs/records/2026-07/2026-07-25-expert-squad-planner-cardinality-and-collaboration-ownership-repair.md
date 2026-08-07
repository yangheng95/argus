# Expert Squad Planner Cardinality and Collaboration Ownership Repair

Date: 2026-07-25

Status: Implemented and validated.

## Recall

| Item                       | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Inspect the current Prism Expert Squad and OpenCorvus infrastructure, extrapolate likely failures from incident records, find Expert Squad and Squad Software Development Kit (SDK) design defects, and repair them.                                                                                                                                                                                                                                                                                                                                                              |
| Acceptance criteria        | Every defect is tied to source or a reproduced failure. Every source change has regression coverage. The repair does not add a Host workflow gate, state machine, fallback, compatibility alias, keyword router, or second active-squad source. All unrelated worktree changes remain untouched.                                                                                                                                                                                                                                                                                  |
| Hard constraints           | Follow `AGENTS.md`, especially rules 6.1, 8, 15.1, 24, 28, 32, 33, 35 and 36. `prompt_profile.active`, manifest identity, `PromptProfileResolver`, and binding `virtual_workflows` remain their existing single sources. Commit subjects use `dsw-33987`; push to `myhexin`. Do not restart or interfere with OpenCorvus/Overlay processes.                                                                                                                                                                                                                                       |
| Existing worktree          | Branch `v0.0.18beta` matched `myhexin/v0.0.18beta` at `41452ca44e`. Unrelated `packages/overlay/src/services/events.ts`, `expert-squads/.DS_Store`, and `packages/overlay/.codex-tmp/` changes are preserved and excluded.                                                                                                                                                                                                                                                                                                                                                        |
| Sources read               | `AGENTS.md`; current Expert Squad architecture and public SDK docs; the 2026-07-22 through 2026-07-25 Prism, collaboration, Goal identity, Goal continuation, Goal granularity, SDK legality, fact/Turn, and dispatch-scope incident records; Prism manifest, README, selector, scheduler prompt, Mission Skill and collaboration definitions; `packages/opencorvus/src/expert-squad/**`; `packages/sdk/js/src/expert-squad-authoring.ts`; focused Registry, package-manager, Prism, collaboration, and SDK tests.                                                                |
| Whole-repository grep      | Enumerated every `virtual_workflow`, `depends_on`, `dispatch_scope`, `goal_concurrency`, `validateExpertSquadManifestDispatchTopology`, `validateExpertSquadCollaboration`, `ExpertSquadCollaborationDefinition`, `repair_agent_id`, `writeExpertSquadPackage`, `renderExpertSquadPackageFiles`, `validateExpertSquadPackageDefinition`, package Manager cleanup scenario, and repository Expert Squad manifest call point. Loaded all eight repository-authored packages through the real Registry and summarized every workflow's Task/Goal/Requirements/Architect cardinality. |
| Independent agent feedback | No independent Agent was requested. The current collaboration policy prohibits inferred sub-agent spawning; the primary agent will perform the required second review.                                                                                                                                                                                                                                                                                                                                                                                                            |

## Incident-derived findings

### 1. Goal workflow planner cardinality is not a shared invariant

The duplicate-Goal incident was repaired only in Prism prompts and roles: later
phase planners became delegated frontier validators, and the Prism manifest now
contains one Task-scoped Requirements node and one Task-scoped Architect node.
The shared SDK/Registry validator merely checks that at least one planned
Architect exists and that each Goal node descends from any such Architect.

That accepts the exact systemic shapes that can recreate the incident:

- two Task-scoped Requirements/Architect pairs in one Goal workflow;
- an additional Goal-scoped Requirements or Architect adapter beside one valid
  pair;
- extra typed planner nodes that are not the canonical pair.

Because Requirements and Architect adapters persist canonical planning facts,
this is package data integrity, not a Host dispatch gate. Goal workflows must
contain exactly one Task-scoped Requirements adapter and exactly one
Task-scoped Architect adapter; every typed planner node in that workflow is that
pair, the Architect descends from Requirements, and every Goal node descends
from the Architect.

### 2. Collaboration definitions assign whole-workflow ownership to one agent

`ExpertSquadCollaborationStage.repair_agent_id` is mandatory for every Mission
Task stage. Generic and AInvest Prism delivery therefore name
`mirror-code-implementer` as the "repair agent" for the entire 40/44-node
workflow, while MirrorTest retest stages name `opentest-test-implementer`.

The field has no runtime executor and contradicts the binding workflow:
ownership belongs to the fixed-profile Task and its complete selected graph,
not to one worker. In delivery it is semantically false; in recovery it invites
Mission to bypass reproduction, independent review, convergence, and release
nodes by routing directly to the named worker. Remove the field and its
validator. Exact `squad_id` plus `workflow_id` remains the sole stage execution
contract.

### 3. SDK package writing can lose the primary failure

`writeExpertSquadPackage()` removes a newly created destination after a write
failure, but if that removal fails, the cleanup error replaces the original
write error. Manager import paths already preserve primary and cleanup failures
as an `AggregateError`; the SDK writer needs the same evidence-preserving
contract without importing Host Manager code.

### 4. Cleanup evidence was duplicated behind process-global fault injection

The combined Expert Squad and SDK run reproduced two failures:

1. the package-manager archive-success cleanup fixture exited with signal 15
   while launched through raw `Bun.spawn`;
2. the real Browser MCP namespace lifecycle test lost structured output after
   its child process was killed.

Both tests passed alone. The Browser MCP case ran a real process/browser inside
a file that the broad suite executed concurrently, so it now runs through the
existing isolated Bun-test harness.

The Manager case exposed a deeper defect. Raw `Bun.spawn`, `ProcessSupervisor`,
an outer isolated Bun runner, `unref`, and synchronous spawning were all killed
by the broad runner in repeated executions. The fixture existed only to install
a process-global `fs` mock before importing Manager. Production Manager also
implemented primary-plus-cleanup failure composition twice: once for directory
installation and once for ZIP import.

The final repair removes the process-global fixture and introduces one internal
`ExpertSquadCleanup` implementation. Directory installation and ZIP import both
use it. Direct tests prove ordered cleanup attempts, primary `cause`
preservation, all failure combinations, and success only after cleanup. Existing
Manager integration tests continue proving real rollback, replacement restore,
payload cleanup, archive import, and cross-process installation serialization.

## Call-point disposition

| Surface                                                                | Disposition                                                                                                                                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/sdk/js/src/expert-squad-authoring.ts`                        | Enforce sole Task-scoped Requirements/Architect pair for workflows containing Goal nodes; remove collaboration `repair_agent_id`; preserve package-write primary and cleanup failures. |
| `packages/opencorvus/src/expert-squad/registry.ts`                     | No duplicate logic; it continues calling the SDK topology validator.                                                                                                                   |
| All repository package manifests                                       | Validate unchanged packages through the stronger shared rule; Prism is the incident-derived positive case.                                                                             |
| Prism Mission collaboration JSON                                       | Remove the false single-agent stage ownership field from generic, AInvest, product-recovery, and visual-recovery definitions.                                                          |
| Mission Skill generated payload                                        | Regenerate through the canonical Mission Skill generator after source JSON changes.                                                                                                    |
| SDK collaboration and authoring tests                                  | Add invalid multiple/wrong-scope planner cases, workflow-owned collaboration assertions, and write-plus-cleanup aggregation coverage.                                                  |
| Package Manager cleanup and ZIP import                                 | Replace duplicate aggregation logic and the process-global fault-injection fixture with one internal `ExpertSquadCleanup` implementation plus direct failure-composition tests.        |
| Frontend Replica Browser MCP lifecycle test                            | Run the real browser case in the existing isolated-test harness with exact pass and no-killed-process assertions.                                                                      |
| Architecture, public English/Chinese docs, portable authoring artifact | Replace repair-agent language with whole-workflow stage ownership and document the sole planner-pair invariant; regenerate owned artifacts.                                            |

## Validation plan

- SDK authoring and collaboration tests.
- Registry, virtual-workflow, Prism, Mission Skill payload, and package Manager
  focused tests.
- The real Frontend Replica namespace lifecycle browser regression in isolation.
- Combined `packages/opencorvus/test/expert-squad` plus `packages/sdk/js/test`.
- OpenCorvus and SDK typechecks, generated-artifact checks, API route checks,
  documentation checks, historical-link and document-health suites.
- Final semantic diff review, task-owned staging only, commit, pre-push hooks,
  push, and remote equality verification.

## Implementation outcome

- The shared SDK/Registry topology validator now rejects every workflow that
  contains Goal nodes without exactly one Task-scoped Requirements node and one
  downstream Task-scoped Architect node. It also rejects duplicated,
  wrong-scope, or disconnected typed planners in Task-only planning workflows.
- Collaboration stages no longer publish `repair_agent_id`. Fixed-profile
  Mission Task plus exact selected workflow is the sole stage execution owner.
- SDK package authoring preserves both the original write failure and a failed
  destination cleanup in one ordered `AggregateError`.
- Manager directory and ZIP cleanup failure composition now has one internal
  implementation; the obsolete process-global fault-injection fixture is
  removed.
- The real Frontend Replica Browser Model Context Protocol (MCP) namespace
  lifecycle runs through the isolated Bun-test harness and still verifies the
  exact structured result.
- Portable authoring artifacts, Mission Skill payload, architecture, and public
  English/Chinese SDK documentation were regenerated or updated from their
  canonical sources.

## Validation evidence

| Command                                                                                                                                                             | Result                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `bun run --cwd packages/sdk/js build`                                                                                                                               | Passed; generated SDK refreshed before Registry validation.                                                        |
| Focused SDK authoring, cleanup, collaboration, Registry, virtual-workflow, portable-template, dynamic-agent Registry, Browser lifecycle, Manager, and cleanup tests | Passed.                                                                                                            |
| `bun test packages/opencorvus/test/expert-squad packages/sdk/js/test`                                                                                               | 506 pass, 2 intentional skips, 0 fail, 9,213 expectations across 52 files.                                         |
| `bun run --cwd packages/sdk/js typecheck` and `bun run --cwd packages/opencorvus typecheck`                                                                         | Passed.                                                                                                            |
| `bun run api:routes-check` and `bun run docs:check`                                                                                                                 | Passed; 6 route rules across 32 files and 291 documentation operations across 24 groups.                           |
| `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`                                    | Historical links passed; document-health was temporarily blocked by an unrelated concurrent untracked July record. |

No user-facing UI surface changed, so this repair does not require visual
screenshots. The real Browser MCP lifecycle remains covered as runtime evidence,
not as a substitute for visual acceptance.
