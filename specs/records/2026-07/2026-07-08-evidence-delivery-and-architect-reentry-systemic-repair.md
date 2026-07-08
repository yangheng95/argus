# Evidence Delivery and Architect Re-entry Systemic Repair

Date: 2026-07-08
Status: Proposed

## Recall

| Item | Details |
| --- | --- |
| User request | Investigate the recurring failure where scheduling calls Architect again mid-run, use independent agents to analyze common failure modes across expert squads, and write a detailed systemic repair plan. The user then corrected the framing: diff is not the key; delivery evidence is key, and using diff as the success predicate is wrong. |
| Acceptance criteria | The repair plan must not be case-specific to the TradingView Futures task or frontend-replica. It must explain why Architect re-entry recurs, why the failure can affect other expert squads, and how to fix the scheduling/evidence model without fallback, compatibility lanes, host-side workflow gates, or a second expert-squad active source. The plan must use evidence delivery, not file diff, as the success predicate. |
| Hard constraints | Follow `AGENTS.md`; no fallback/compatibility logic; no host gate teaching the LLM route; no state machine repair; no git reset/destructive command; no new worktree; do not restart/refresh/kill OpenCorvus or overlay; keep specs under `specs/`; code changes require tests; expert squads remain capability packages projected by `PromptProfileResolver`; workflow remains scheduler-owned. |
| Sources read | `AGENTS.md`; `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`; `specs/README.md`; `specs/current/architecture/04-extensions.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-06-current-project-goal-diff-and-graph-repair.md`; `specs/records/2026-07/2026-07-07-dependency-contract-single-source-repair.md`; `specs/records/2026-07/2026-07-01-task-request-single-source-requirements-rerun.md`; `specs/records/2026-07/2026-07-02-frontend-replica-workflow-goal-discipline.md`. |
| Whole-repository grep | `rg -n "dispatch_agent target=architect\|no_project_diff\|register_dependency_contract\|architect_contract_graph\|modify_goal refused\|depends_on is owned\|OrchestratorNoDecisionStopError\|goal_run\|build_attempt_outcome" packages specs`; `rg -n "deriveGoalDeliveryState\|GoalDelivery\|delivery state\|dependency-ready\|dispatchable_goal_ids\|passed_goal_ids\|goalDependencyDispatchState\|buildCollaborationClosure\|ArchitectInputSchema\|continuation_contract\|verification_contract" packages/opencorvus/src packages/opencorvus/test specs`; `rg -n "create_task\|propose_task\|kind.*workflow\|task_request\|prompt_profile\|PromptProfileResolver\|Mission" packages/opencorvus/src packages/opencorvus/test specs/records/2026-07`. |
| Runtime evidence | The observed Futures audit chain had a producer goal marked lifecycle `passed` while its build attempt outcome was `no_project_diff(actual_changed_files_empty)`. `collaboration_closure` exposed downstream goals as ready from lifecycle status, while build dispatch later rejected the same dependency as unfinished. A task-level repair wrote unscoped evidence (`goal_id=null`), so it could not satisfy the producer goal. `modify_goal depends_on` was correctly refused by the Architect contract graph guard, but the refusal text and several tool results pointed the scheduler toward Architect re-entry. A later final-verification task was a fresh `kind=workflow`, so it naturally reran requirements/architect instead of inheriting a verification contract. |
| Independent agent feedback | Godel found the single-source split: lifecycle `passed` is not evidence delivery; `collaboration_closure` and build dispatch use different readiness predicates. Dalton found prompt/tool/schema surfaces that expose Architect as a generic repair option. Helmholtz found final verification is modeled as a new workflow, not a continuation/verification contract. Hume found the test suite only covers isolated pieces and lacks a full replay asserting no Architect tool part/session/contract graph is created. |

## Corrected Principle

The root abstraction is **evidence delivery**, not diff delivery.

File diffs are only one possible evidence kind for implementation goals. They are not a universal success predicate. A goal can be legitimately satisfied by structured report, audit, verification, research, design, screenshot, command, browser, or manual operator evidence when that is what the goal contract requires. Conversely, a file diff does not prove success unless it is tied to the goal's required evidence contract.

The existing `no_project_diff` language conflates two different facts:

1. No source file changed.
2. No acceptable delivery evidence exists for this goal.

Only the second fact can block dependency readiness. The repair must remove that conflation.

## Failure Modes

### 1. Lifecycle Passed Is Treated as Dependency Ready

`finalizeBuildAttempt` can write `goal_run_attempt.status=completed` while also writing a `build_attempt_outcome` that says no delivery evidence exists. Current task description then derives `passed_goal_ids` and `dispatchable_goal_ids` from lifecycle completion rather than the goal's evidence contract.

Affected surfaces:

- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/engine/goal-status.ts`
- `packages/opencorvus/src/engine/describe.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/workbench/board.ts`

### 2. Evidence Is Scoped to the Wrong Owner

Task-level repair can produce useful artifacts, but if the blocked dependency is a goal-level producer, unscoped task evidence cannot satisfy that producer's contract. The system currently lacks a single way to say: "this evidence satisfies goal X's contract."

Affected surfaces:

- `engine_artifact.goal_id`
- `engine_artifact.goal_run_id`
- `build_attempt_outcome`
- acceptance / review / report artifacts
- `findBuildOutcomeByGoalRun`
- task debug projection

### 3. Architect Is Exposed as a Generic Recovery Lane

The strict prompt already says Architect re-entry is only valid when a persisted Architect artifact is proven invalid and named. But tool results and workflow hints still list `dispatch_agent target=architect` as a peer next action after build, workload, integrity, cancellation, and graph errors. The model sees that as a valid generic fix.

Affected surfaces:

- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/engine/describe.ts`
- Architect dispatch input schema

### 4. Dependency Graph Ownership Error Points at the Wrong Level

The `modify_goal depends_on` refusal is correct because dependency contracts are Architect-owned. The current message, however, tells the scheduler to use Architect `register_dependency_contract` / `submit_architect`, which are Architect-session internal tools. For a producer evidence failure, this directs the scheduler toward the wrong owner.

Correct behavior:

- producer evidence missing -> repair producer evidence;
- point contract text wrong -> `manage_task action=modify_goal`;
- persisted graph artifact invalid -> Architect structural re-entry with named artifact and evidence;
- task contract fundamentally wrong -> `manage_task action=propose_task` or fail/question.

### 5. Final Verification Is a Fresh Workflow

Mission/follow-up final verification currently creates a new `kind="workflow"` task with natural language request text. A fresh workflow exposes the normal pipeline, including requirements and architect. Without a structured continuation/verification contract, rerunning Architect is expected behavior.

Affected surfaces:

- `packages/opencorvus/src/engine/model.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`

## Target Architecture

### A. Goal Evidence Contract

Every executable goal must have a single evidence contract. The contract says what evidence satisfies the goal; it does not assume code diff.

Proposed shape:

```ts
type GoalEvidenceContract = {
  contract_id: string
  goal_id: string
  required_evidence: Array<
    | { kind: "source_change"; paths?: string[]; reason: string }
    | { kind: "command_result"; command_family: string; reason: string }
    | { kind: "browser_evidence"; viewport_or_region?: string; reason: string }
    | { kind: "visual_report"; reason: string }
    | { kind: "integrity_report"; reason: string }
    | { kind: "research_brief"; reason: string }
    | { kind: "design_or_prd"; reason: string }
    | { kind: "manual_completion"; reason: string }
    | { kind: "artifact_ref"; artifact_kind: string; reason: string }
  >
}
```

This should be produced by Architect for normal workflow goals and by explicit task creation for non-Architect verification tasks. It is not a second workflow engine; it is the evidence half of the existing goal contract.

### B. Goal Evidence State

Add one engine-owned derivation helper, for example `deriveGoalEvidenceState(goalID)`, and make every dependency/readiness surface use it.

Proposed shape:

```ts
type GoalEvidenceState = {
  goal_id: string
  lifecycle: "not_started" | "running" | "completed" | "failed" | "aborted" | "cancelled"
  evidence_status: "satisfied" | "unsatisfied" | "blocked" | "failed"
  dependency_ready: boolean
  evidence_refs: string[]
  missing_evidence: string[]
  reason: string
}
```

Rules:

- `dependency_ready=true` only when the goal evidence contract is satisfied.
- Build outcome `delivered` is evidence only when it includes refs that satisfy the contract.
- File changed lists are supporting evidence, not the success predicate.
- `no_project_diff` should be retired or narrowed to a file-fact label; it must not mean "goal failed" unless the goal contract required file-change evidence and no equivalent evidence exists.
- Missing normal build outcome cannot be silently accepted.
- Manual completion is allowed only when it writes explicit manual evidence refs/reason.

### C. Replace Collaboration Closure Readiness

`collaboration_closure` must stop deriving readiness from lifecycle `passed`. Replace or rename fields:

- replace `passed_goal_ids` with `evidence_satisfied_goal_ids`;
- replace `dispatchable_goal_ids` calculation with `deriveGoalEvidenceState(dep).dependency_ready`;
- include `blocking_dependency_evidence_reasons` so the Orchestrator sees why a dependency is not ready.

Because this project is unpublished, do not preserve compatibility fields that keep the old meaning alive.

### D. Build Attempt Outcome Reframing

`build_attempt_outcome` should report delivery evidence, not primarily file diff.

Proposed changes:

- Add `delivery_evidence_refs` and `evidence_contract_status`.
- Keep `actual_changed_files` as a file fact.
- Treat host diff collection failure as failure of the `source_change` evidence channel, not as generic delivery failure.
- A no-file-change report can be successful if it satisfies a non-source-change evidence contract.
- A file diff without required verification/report evidence is not sufficient.

### E. Goal-Scoped Evidence Publication

Task-level evidence must not satisfy a goal dependency unless it is explicitly linked to that goal's evidence contract.

Valid options:

- dispatch the producer goal again and publish goal-scoped evidence;
- use `complete_goal` only with explicit evidence refs satisfying that goal's contract;
- create a separate verification task only when the current task contract is invalid or complete, with an explicit continuation/verification contract.

Invalid options:

- task-level build/report that leaves `goal_id=null` and then expecting downstream goal dependencies to unblock;
- deleting or rewriting dependency edges to bypass missing producer evidence;
- using Architect to bless a missing evidence producer.

### F. Architect Structural Re-entry Contract

Architect dispatch should distinguish initial decomposition from structural re-entry.

Proposed schema:

```ts
type ArchitectDispatchInput =
  | {
      mode: "initial_decomposition"
      reason: string
      continuation_artifact_id?: string
    }
  | {
      mode: "structural_reentry"
      reason: string
      invalid_architect_artifact_id: string
      defect_kind:
        | "contract_graph_inconsistent"
        | "missing_required_goal"
        | "wrong_decomposition_boundary"
        | "invalid_dependency_contract"
      evidence_refs: string[]
      why_build_or_modify_goal_cannot_repair: string
    }
```

This is not a host gate. It is the tool contract for a powerful structural action. The Orchestrator still chooses, but it must provide the evidence it already claims to have.

### G. Continuation / Final Verification Contract

Final verification must be a first-class task contract, not a title convention.

Proposed shape:

```ts
type VerificationContract = {
  parent_task_id: string
  inherited_requirement_refs: string[]
  inherited_architect_artifact_refs: string[]
  inherited_goal_refs: string[]
  verification_scope: string[]
  allowed_reentry:
    | "verification_only"
    | "repair_existing_goal_evidence"
    | "structural_reentry_with_named_invalid_artifact"
  evidence_refs: string[]
}
```

Mission and `propose_task` must pass this contract when they create final verification tasks. Orchestrator prompt context must render it as structured context. If a verification task should not run requirements/architect, select a scheduler-owned verification workflow that exposes verification/review/build-repair tools only. Do not implement this as keyword detection on "final verification".

Expert squads remain capability packages. They must not own separate continuation semantics or workflow engines.

## Impact Analysis

Adding a new evidence contract is not a local schema tweak. It changes the source of truth for whether work is consumable by downstream goals. The impact is broad because the current system leaks lifecycle state, file diff facts, and report text into places that really need one evidence-satisfaction predicate.

### Must Change

1. Engine task / goal model

   `engine_goal` or the active `architect_contract_graph` must carry required evidence contract data. The chosen location must be single-source. Do not store a second divergent copy in task metadata, board projection, or expert-squad package files.

2. Architect output tools

   Architect must emit goal evidence contracts when registering goals. A goal contract cannot only say title, owned paths, acceptance specs, and dependencies; it must also say which evidence kinds satisfy the goal. Dependency contracts then depend on evidence satisfaction, not lifecycle completion.

3. Agent terminal output protocol

   Worker agents must end with durable evidence publication bound to task / goal / goal_run and evidence contract refs. This does not mean every agent writes a free-form handoff report. It means every terminal agent result must either publish structured evidence or explicitly leave the evidence contract unsatisfied.

4. Evidence artifact model

   Existing artifacts such as `build_attempt_outcome`, acceptance artifacts, visual QA reports, integrity reports, research briefs, frontend evidence, and manual completion facts need a common way to declare which contract item they satisfy. The artifact kind remains domain-specific; the satisfaction binding is shared.

5. Dependency readiness

   `collaboration_closure`, build dispatch dependency checks, retry guidance, board/debug projection, and task descriptions must call the same `deriveGoalEvidenceState`-style helper. No caller should independently decide that `goal_run_attempt.status=completed` means downstream-ready.

6. Build outcome semantics

   `actual_changed_files` remains useful as file evidence, but it must be demoted from success predicate to evidence detail. `build_attempt_outcome` needs evidence refs / contract satisfaction status. A no-diff build can be successful for a report/verification goal, and a diff-bearing build can still be insufficient for a goal requiring browser or visual evidence.

7. Manual `complete_goal`

   Manual completion must include evidence refs or a structured manual evidence artifact. Otherwise it is only lifecycle mutation and cannot satisfy dependencies.

8. Orchestrator prompt and tool-result language

   Prompts and tool results must stop listing Architect as a generic repair option. They should route by evidence state: missing producer evidence -> repair producer evidence; point contract text fix -> `modify_goal`; invalid persisted Architect artifact -> structural Architect re-entry with named evidence.

9. Architect dispatch schema

   Architect dispatch must distinguish initial decomposition from structural re-entry. Structural re-entry must name the invalid Architect artifact and evidence. This is tool-contract shape, not a host gate.

10. Mission / propose_task continuation

   Final verification or continuation tasks need a structured verification contract. Without it, a new `kind="workflow"` task will naturally expose requirements and Architect again.

11. Board / overlay / task debug output

   UI surfaces must separate lifecycle from evidence satisfaction. A completed run can be evidence-unsatisfied. A report-only goal can be evidence-satisfied without changed files. Debug output should show contract refs and missing evidence, not only accepted/attempt changed files.

12. API / SDK / docs if public shapes change

   Renaming or replacing `passed_goal_ids`, `dispatchable_goal_ids`, or build outcome fields affects generated OpenAPI, SDK types, web docs, and overlay clients. Because the project is not released, this should be a direct contract replacement rather than compatibility aliasing.

13. Tests and benchmark replays

   Existing tests that equate lifecycle completion or diff presence with success must be rewritten. New tests must cover evidence-satisfied report goals, implementation goals missing non-file evidence, task-level evidence not satisfying goal dependencies, and the no-Architect replay chain.

### Must Not Change

1. Expert-squad active source

   `prompt_profile.active` remains the only active expert-squad source, and `PromptProfileResolver` remains the projection owner. Evidence contracts must not add a second active squad field or package-local workflow selection.

2. Workflow ownership

   Expert squads can influence role prompts and capabilities, but they must not create a second workflow engine. If verification needs a distinct workflow, it belongs in scheduler `WorkflowRegistry`.

3. Artifact append-only discipline

   Evidence satisfaction should be derived from durable artifacts. Do not mutate old artifacts into new meanings or synthesize hidden messages to make a goal look satisfied.

4. No fallback delivery

   Missing evidence must stay missing. Do not infer evidence from report prose, file names, task titles, or "completed" status.

5. No blanket report requirement

   The requirement is not "every agent must hand off a report." The requirement is "every terminal agent must leave structured evidence or an explicit unsatisfied evidence state." Reports are one evidence kind, not the universal evidence kind.

## Implementation Goals

1. Define `GoalEvidenceContract` and `GoalEvidenceState` in the engine model layer.
2. Extend Architect goal registration to include required evidence contracts.
3. Update manual `complete_goal` to require explicit evidence refs/reason when satisfying a goal.
4. Rework `build_attempt_outcome` to store `delivery_evidence_refs` and evidence contract status.
5. Replace `buildCollaborationClosure` readiness with `deriveGoalEvidenceState`.
6. Replace `goalDependencyDispatchState` with the same helper.
7. Update task debug / board / workbench projection to show lifecycle separately from evidence satisfaction.
8. Remove or rename public `passed_goal_ids` / `dispatchable_goal_ids` fields that encode lifecycle-as-readiness.
9. Rewrite tool-result text so Architect is never listed as a generic repair option.
10. Rewrite dependency graph mutation refusal text to route producer evidence failure back to producer evidence repair, not Architect.
11. Make Architect dispatch schema support `initial_decomposition` and `structural_reentry`.
12. Add final-verification / continuation contract to task creation and child-task proposal surfaces.
13. Render parent/evidence/verification contract in Orchestrator follow-up context.
14. Add a scheduler-owned verification workflow only if final-verification tasks must omit requirements/architect from visible targets.
15. Update expert-squad projection tests to prove active squad still only comes from `prompt_profile.active` and projection remains workflow tools intersect active capability.

## Test Matrix

### Engine Evidence State

- Seed completed goal run + no delivery evidence; assert `dependency_ready=false`.
- Seed report-only verification goal with matching report evidence; assert `dependency_ready=true`.
- Seed implementation goal with file diff but missing required browser/command evidence; assert `dependency_ready=false`.
- Seed manual completion with evidence refs; assert `dependency_ready=true`.
- Seed manual completion without evidence refs; assert rejected or `dependency_ready=false`.

Suggested files:

- `packages/opencorvus/test/engine/goal-evidence-state.test.ts`
- `packages/opencorvus/test/engine/describe-bootstrap-active.test.ts`

### Orchestrator Tool Contract

- Consumer goal build blocked by producer evidence state uses the same reason as `collaboration_closure`.
- Task-level build outcome with `goal_id=null` does not satisfy producer goal dependency.
- `modify_goal depends_on` refusal leaves DB and Architect graph unchanged and does not recommend generic Architect.
- `delete_goal` cannot delete graph-owned producer/consumer without preserving contract graph consistency.

Suggested files:

- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/orchestrator/no-project-diff-recovery-flow.test.ts`

### Architect Re-entry

- Initial Architect dispatch accepts `mode="initial_decomposition"`.
- Structural re-entry without named invalid artifact/evidence is schema-invalid.
- Structural re-entry with named graph artifact and evidence is accepted.
- Tool descriptions and core prompt contain no bare `dispatch_agent target=architect` generic repair menu.

Suggested files:

- `packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts`
- `packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts`

### Message Flow Replay

Replay the observed failure pattern:

1. Producer has lifecycle completed but evidence unsatisfied.
2. Consumer dispatch is blocked.
3. Producer retry lacks recorded worktree.
4. Task-level repair writes unscoped evidence.
5. Consumer remains blocked for the same evidence reason.
6. `modify_goal depends_on` is refused.
7. No `dispatch_agent target=architect` tool part is emitted, no Architect session is created, and no new `architect_contract_graph` artifact is written.

Suggested file:

- `packages/opencorvus/test/orchestrator/no-project-diff-recovery-flow-process.test.ts`

This is a real observable message-flow replay, not full product E2E.

### Mission / Continuation

- Mission-created final verification task writes a structured `VerificationContract`.
- `propose_task` child task renders `parent_task_id`, evidence anchor, inheritance, and verification contract into Orchestrator context.
- Verification workflow, if introduced, does not expose requirements/architect unless explicitly declared.
- Active expert squad remains projected only by `prompt_profile.active`.

Suggested files:

- `packages/opencorvus/test/agent/agent.test.ts`
- `packages/opencorvus/test/control/create-task-request-contract.test.ts`
- `packages/opencorvus/test/engine/task-parent-projection.test.ts`
- `packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`

## Validation Commands

Use inactivity-aware wrappers where long-running commands are needed; do not rely on elapsed wall-clock timeout.

Focused commands:

```powershell
bun test packages/opencorvus/test/engine/goal-evidence-state.test.ts --timeout 120000
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "evidence|dependency|modify_goal refuses depends_on" --timeout 120000
bun test packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts --timeout 120000
bun test packages/opencorvus/test/orchestrator/no-project-diff-recovery-flow-process.test.ts --timeout 120000
bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts --timeout 120000
bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000
```

If current architecture docs or public API schema change:

```powershell
bun test packages/opencorvus/test/script/document-health.test.ts --timeout 120000
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000
bun run --cwd packages/opencorvus typecheck
```

## Non-goals

- Do not add a host-side "do not call Architect" gate.
- Do not special-case frontend-replica.
- Do not infer continuation from task title text such as "final verification".
- Do not keep old lifecycle-as-readiness fields as compatibility aliases.
- Do not use file diff as the generic success predicate.
- Do not let task-level unscoped evidence satisfy goal dependencies implicitly.
- Do not add a second active expert-squad source.

## Open Questions

- Should `GoalEvidenceContract` live directly on `engine_goal` or be an `architect_contract_graph` substructure with engine projection helpers?
- Should existing `build_attempt_outcome.outcome_kind="no_project_diff"` be retired immediately, or renamed to a file-fact field while adding `evidence_contract_status` as the authoritative result?
- Should verification workflow be a new `WorkflowRegistry` entry, or should a `VerificationContract` constrain the existing pipeline projection?
- Should `complete_goal` be restricted to manual evidence only, or also allow referencing existing task/goal artifacts that satisfy the goal contract?

## Acceptance for the Repair

The systemic repair is accepted only when:

- one engine helper owns dependency readiness from evidence contract state;
- task snapshots, build dispatch, board/debug output, and retry guidance all render the same evidence readiness reason;
- report/verification goals can satisfy dependencies without file diffs when their evidence contract is met;
- implementation goals cannot pass merely because a file diff exists;
- Architect re-entry requires named invalid Architect artifact evidence;
- final verification tasks carry structured continuation/verification contracts;
- the replay test proves the observed failure chain cannot create an Architect tool call/session/contract graph as a recovery side effect;
- docs and tests are updated without fallback or dual-source semantics.
