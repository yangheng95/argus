# Retire Execution Liveness And Task Run

Date: 2026-07-23

Status: Implemented, validated, committed, and pushed to
`legacy-remote/v0.0.17beta`. Final independent read-only re-review returned `ACCEPT`
after removal of the remaining Task-level acceptance double source and its
residual read/write contracts. Only the restart-gated real Mirror replay
remains recorded below.

## Recall

| Item | Requirement or evidence |
| --- | --- |
| User requirement | Investigate why the removed `live` concept returned, distinguish infrastructure from Expert Squad responsibility, and provide a systemic repair. Do not add a missing-Run patch, a new owner for a live Run, or another compatibility path. |
| Incident | A Mirror Design Visual Quality Assurance report was persisted, but its finalizer called `findActiveRunForTask`, found no status-classified live Run, threw `no active run is available`, and caused the scheduler to report failure after the specialist had already completed. |
| Layer classification | The exception and scheduler/result disagreement are infrastructure defects. Source selection, implementation fidelity, and the visual verdict remain Expert Squad responsibilities. |
| User correction | Persistent or derived `live` concepts create stale control locks and have no necessary role in task execution. The attempted Task-Control-Loop-owned Run design reintroduced the rejected abstraction and must be removed before implementation. |
| Historical evidence | `30bc964d1` removed `task.active_run_id` but retained the semantic projection; `2a7c13e3e` explicitly restored coordinator Run creation instead of completing the task-centric rewrite; `3d79816d5` changed the shared helper to live-only semantics; `ad89bd46d` retired only selected GoalRun status gates; `a15096a14` introduced the current Visual QA active-Run requirement; `2c10adb6d` removed only the generic Browser Preview gate; `03470db13` made Task and Run terminal writes atomic and therefore exposed the latent finalizer contradiction deterministically. |
| Architecture read | `specs/current/architecture/01-agents.md`, `02-data.md`, `03-control.md`, `09-verification-evidence.md`, `16-unified-teardown.md`, `2026-06-27-active-run-projection-retry-convergence.md`, `2026-06-30-retire-live-run-control-source.md`, and `2026-07-03-rendered-reference-acceptance-redesign.md`. |
| Whole-repository audit | The first audit covered `findActiveRunForTask`, `findLatestRunForTask`, `RunRow`, `EngineRunStatus`, `createRun`, `updateRun`, `listLiveRuns`, `activeRunBySession`, core `run_id` / `runID` fields, GoalRun live classifiers, and live dispatch-ownership queries. Independent review expanded it to renamed liveness: `ProjectedAgentExecutionLease`, `executionLease`, `goal_concurrency`, task-loop chains/passes/launches/completions/quiescence, runtime-state, `loopInFlight`, `taskAborts`, dispatch ownership, SessionPrompt controllers, and package-owned same-name test-run IDs. Reproducible commands are recorded below. |
| Independent feedback | Independent read-only reviewer `/root/independent_live_arch_review` returned `REJECT` on the first draft. It proved that `ProjectedAgentExecutionLease` is an omitted in-memory live gate; deleting dispatch ownership outright loses the only exact tool-call-to-child-Session edge; stop/delete needs one physical cancellation/quiescence source; the 84-file claim mixed incomparable searches and missed renamed liveness; a repository-wide `run_id` ban would incorrectly delete MirrorTest's package-owned test-run identity; rendered Browser Preview evidence already has immutable artifact identity; and the original slice order could not compile. Its second review rejected the remaining Run-consumer slice ordering and undefined concurrent-wake serialization. After both corrections, its final read-only review returned `ACCEPT`: Slice 4 removes all consumers before schema/types/routes, and `SessionPromptState` is the single persist-before-enqueue root-Session wake queue. |
| Independent implementation feedback | Independent read-only reviewer `/root/independent_live_arch_final_review` rejected the first implementation snapshot. It found that invalid Visual QA PASS evidence still threw after the report was persisted; the destructive scope blocked root wakes but not child Session creation after cancellation enumeration; verification omitted the report judgment tool part/call identity; delivery re-read the current worktree instead of an immutable acceptance candidate; generated documentation retained `/runs`; and Goal-attempt read models retained always-null retry/blocker compatibility projections. A later review found one final double source: Board, Progress, and Orchestrator promoted the newest per-Goal acceptance/evaluation row into Task delivery while `complete_task` published a separate immutable candidate without binding it to the terminal Task fact. Its next review found four residuals of that same source: operator wake did not clear the terminal binding, verification still exposed a Task-latest `acceptance` scope, Progress/OpenAPI retained the old Task acceptance/evaluation fields, and current architecture docs still described those retired sources. The implementation now clears the exact binding on every terminal reopen, exposes verification only by exact Goal-attempt identity, projects only `acceptanceCandidate`, and documents that single source. The final read-only re-review returned `ACCEPT`: it confirmed the execution-liveness surfaces are absent, the physical queue is not a workflow state machine, Visual QA judgment and evidence validation remain separate, terminal Task delivery reads only its exact bound candidate, and no compatibility/latest acceptance source remains. |
| Process boundary | No OpenCorvus, Overlay, or Browser Preview sidecar process may be stopped, restarted, refreshed, or reloaded as part of this refactor. Compilation and isolated tests are allowed; activation waits for an explicit user restart request. |

## Root Design Error

Task Run is an aggregate execution container layered above identities that
already exist:

- Task identifies the user-visible unit of work.
- Plan identifies the selected decomposition.
- Goal identifies a durable objective.
- Session identifies a real model conversation.
- Tool call identifies a concrete invocation.
- Goal attempt identifies one bounded implementation attempt.
- Artifact and verification IDs identify immutable evidence.
- Acceptance ID identifies one delivery candidate.

The Run duplicates Task lifecycle, Plan selection, Session association, Goal
execution, evidence scope, blocking state, and delivery aggregation. Once that
container exists, every subsystem must reconstruct which Run is "current".
`findActiveRunForTask` turned that reconstruction into a shared control
predicate. A durable status row could then outlive the actual process, while an
actual completed worker could lose its required Run before its finalizer wrote
evidence.

The defect is therefore not that Run creation happens too late. The defect is
that Task Run is required at all.

## Architecture Decision

Delete Task Run as a domain entity and delete execution liveness as a
persistent or derived control concept.

This is a direct replacement, not a compatibility transition:

1. Remove `engine_artifact[kind="run"]`, the Run model, Run status catalog,
   Run writers, Run queries, Run events, Run API projections, and `run_id`
   foreign correlation.
2. Do not replace Run with `attempt_run`, `execution_epoch`, `active task
   attempt`, or another task-wide container.
3. Delete `ProjectedAgentExecutionLease`, its Task-scoped `active[]` /
   `pending[]` pool, terminal transfer, and host enforcement of
   `goal_concurrency`. Keep `goal_concurrency` only as visible scheduler
   guidance in the frozen Expert Squad capability; the Orchestrator reasons
   about it and the host does not queue or refuse a dispatch from it.
4. Keep Goal attempts only as immutable historical attempt identity. A Goal
   attempt does not control scheduling and is never classified as live.
5. Use the real Session and tool-call identities for execution and
   cancellation.
6. Replace mutable `orchestrator_tool_ownership` lifecycle rows with one
   immutable dispatch-lineage edge from the exact visible tool call to each
   child Session. The edge is evidence, never an admission predicate.
7. Use exact artifact references for evidence lineage. A finalizer may validate
   referenced artifacts, but it may not query a "current" execution container.
8. Use Task lifecycle facts only for the user-visible Task. Task completion
   does not terminalize a second execution object.

The word `live` must disappear from the execution-domain Application
Programming Interface. Physical process activity remains observable through
the process that actually owns a `SessionPrompt` controller, but that transient
fact is neither persisted as workflow state nor used to infer a task-wide
execution phase.

### Physical Execution Boundary

Deleting logical liveness does not mean deleting the actual AbortController
that is executing code:

- `SessionPromptState` becomes the single process-local source for an exact
  Session's AbortController and completion Promise.
- Session status projections, Run/Goal-attempt status, dispatch-lineage
  artifacts, process-owner stamps, and user-interface activity indicators
  cannot answer whether an operation is executing.
- Same-Session non-reentrancy is physical resource integrity. It is enforced by
  the actual `SessionPromptState` entry, not by `SessionStatus`.
- Root-Session wake ordering is also physical resource integrity.
  `SessionPromptState` owns the one ordered execution queue for that exact root
  Session. Task events/messages are persisted before enqueue; enqueue never
  rejects because another wake is executing. The queue starts one prompt at a
  time and leaves an unfinished durable wake pending across process failure.
- Explicit stop/delete may hold one short-lived destructive-operation scope
  while it cancels and awaits exact controllers. This exception exists only to
  prevent a new execution from being created between stop enumeration and
  irreversible deletion. It is not persisted, exposed as Task state, or reused
  by dispatch, mutation, report, completion, retry, or acceptance.
- `taskLoopChain`, `taskLoopPasses`, `taskLoopLaunches`,
  `taskLoopCompletions`, `runtime-state.running`, `loopInFlight`, and the unused
  `engine/pipeline.ts::taskAborts` registry must not remain as parallel
  execution-currentness sources. Their necessary wake-ordering behavior is
  folded into the single root-Session prompt queue; their necessary destructive
  behavior is folded into the destructive-operation scope; the remaining
  registries are deleted.

## Target Model

```text
Task
  ├─ selected Plan
  ├─ Goal
  │    └─ Goal attempt identity
  │         ├─ dispatch-lineage edge
  │         ├─ child Session
  │         ├─ worker result
  │         └─ evidence refs
  ├─ task-scoped dispatch_agent tool call
  │    ├─ dispatch-lineage edge
  │    ├─ child Session
  │    ├─ worker result
  │    └─ evidence refs
  └─ Acceptance / verification artifacts
       └─ exact source artifact refs
```

There is no Task Run node and no current-execution lookup.

### Execution

- A `dispatch_agent` call is an ordinary visible tool call and its child
  Session is the concrete execution. Session creation writes one immutable
  dispatch-lineage edge containing Task ID, Orchestrator Session/message,
  tool part/call ID, child Session ID, exact projected agent identity, frozen
  projection hash, work scope, and optional coordination-action ID.
- The shared streaming tool runtime waits for the real call result. Parallel
  calls remain separate tool calls; no task-wide owner is synthesized.
- `ProjectedAgentExecutionLease.acquire`, the Task pool, conflict calculation,
  pending waiter, terminal transfer, and adapter `executionLease` parameter are
  deleted. Dispatch input retains frozen capability identity and typed work
  scope but does not re-query a current projection for admission.
- A Task wake is appended as a visible durable event/message, then enqueued by
  root Session ID through `SessionPromptState`. Enqueue is the only physical
  ordering boundary before the prompt starts; concurrent callers append
  independent wake IDs and never create parallel root prompts. Completion
  drains the next persisted wake. The queue does not inspect Run,
  Goal-attempt, dispatch-lineage, Session-status projection, or
  agent-concurrency policy before accepting a wake.
- Duplicate dispatch avoidance is an Orchestrator reasoning responsibility
  based on visible prior tool calls, child-session results, Goal outcomes, and
  the selected workflow contract. It is not a host refusal.
- Operator steer writes the existing visible coordination request and wakes the
  Orchestrator. It does not find or reopen an execution container.

### Cancellation And Destructive Operations

- Targeted cancellation requires an exact Session ID resolved from the
  immutable dispatch-lineage edge and calls that Session's actual
  `SessionPromptState` controller.
- If that exact controller does not exist in the owning process, cancellation
  reports the physical ownership mismatch and preserves records. It does not
  interpret a status projection as proof that cancellation succeeded and does
  not search status rows for a substitute.
- Task stop traverses the real Session tree, requests cancellation for each
  controller it actually finds, and records the returned settlement facts.
  During this bounded operation only, the destructive-operation scope prevents
  a new Task-root pass or child Session from starting after enumeration.
- Delete/archive remains separate from stop. Irreversible deletion proceeds
  only after the explicit stop operation reports settlement, as required by
  the destructive-operation boundary; no durable liveness query is involved.
- Project/Database replacement obtains the physical database/process exclusive
  resource it needs. It does not scan Run or Session status projections to
  manufacture a business-level lock.

### Goal Attempts

- Replace lifecycle-style GoalRun updates with an immutable Goal-attempt start
  record and ordinary result/evidence artifacts that reference its ID.
- The attempt record contains identity, Goal, Task, selected Plan, dispatch
  lineage-edge ID, workspace ownership, and creation time. Tool-call and child
  Session linkage remains owned by that edge rather than duplicated into the
  attempt. The attempt has no `queued`, `accepted`, `planning`, `running`,
  `evaluating`, or `blocked` state.
- Success, failure, and cancellation are result facts written by the actual
  producer. A missing result is an incomplete historical attempt, not a lock.
- Goal user-interface projection is:
  - `passed` when the newest immutable result for that Goal in the selected
    Plan and its required verification pass;
  - `failed` when that newest immutable result is terminal failure;
  - `pending` otherwise.
- This newest-result read is presentation/history only. Dispatch, mutation,
  completion, retry, acceptance-candidate construction, and delivery cannot
  use the projection as an admission or artifact-selection source.
- Remove the Goal `running` projection. Current worker activity is already
  visible as a Session/tool card and must not become a second Goal state.
- Retry creates another immutable attempt. It never mutates, aborts, or
  supersedes an old attempt merely to unlock scheduling.

### Visual Evidence

- Browser Preview evidence keeps its existing immutable artifact ID, capture
  SHA, target, viewport, and state. No rendered-snapshot container or "current
  snapshot" selector is added.
- Reference comparison evidence explicitly references the source evidence
  artifact and rendered evidence artifact it compared.
- Visual QA verification references:
  - Task ID;
  - Visual QA child Session ID;
  - report tool part/call ID;
  - preview target ID;
  - exact Browser Preview evidence artifact IDs and capture SHAs;
  - report/decision-log reference.
- The verification finalizer validates those references directly. It never
  calls `findActiveRunForTask`, `findLatestRunForTask`, or any replacement
  currentness query.
- Acceptance candidate is an immutable manifest of exact changed-file,
  Build-result, verification, and supporting artifact IDs. Metrics and
  delivery consume that candidate ID; they do not perform `latest applicable`
  queries or share a task-wide Run lineage.
- A specialist `PASS` plus invalid referenced evidence produces a visible
  evidence-contract failure; it does not rewrite the specialist execution as a
  scheduler failure.

### Build And Delivery

- Goal-scoped Build receives Task ID, Goal ID, Goal-attempt ID, dispatch
  tool-call ID, and selected Plan ID explicitly.
- Task-scoped Build receives Task ID, dispatch tool-call ID, and child Session
  ID. It does not create a synthetic Run merely so delivery can aggregate it.
- Build results reference their exact Goal attempt or task-scoped dispatch.
- Delivery reads one immutable acceptance-candidate manifest. The manifest
  lists the selected Plan, exact Goal result IDs, task-scoped dispatch results,
  changed-file artifacts, and verification IDs; delivery never decides which
  results are "applicable" by currentness or timestamp.
- Direct Build and planned Build therefore use the same artifact contract
  without a coordinator Run.

### Interactions, Runtime, And UI

- Permission/question interactions bind to Task ID and originating Session ID.
  Resolution emits a Task wake; no Run lookup or Run blocker mutation occurs.
- Delete `EngineRuntime.monitorRuns`, `syncRun`, Run blocker projection, and
  terminal-Goal polling. The producer that writes a terminal Goal result also
  appends the visible refill wake fact in the same transaction.
- Task terminal writes only Task terminal facts. It does not find or finalize a
  Run.
- Task/Workbench/debug projections remove `activeRunID`,
  `active_run_status`, Run blocking reason, Run orphan flags, and Run history.
  They show Task status, selected Plan, Goals, Sessions, interactions, tool
  calls, results, and evidence directly.

## Exact Active-Run Call-Point Disposition

| Current surface | Replacement |
| --- | --- |
| `engine/store.ts` definitions and `viewTask` | Delete `findActiveRunForTask`, `findLatestRunForTask`, `activeRunBySession`, `activeRunID`, and Run blocking projection. |
| `engine/describe.ts` | Remove active/latest Run description and orphan annotation; render Sessions, Goal attempts, outcomes, and evidence. |
| `engine/interaction.ts` | Resolve ownership from the originating Session/Task relationship and emit a Task wake. |
| `engine/queue.ts` | Remove blocked-Run passive-wake suppression; consume durable Task events without execution-status admission. |
| `engine/runtime.ts` | Delete Run monitors and Run synchronization. Move terminal-result wake creation to the result writer. |
| `engine/state.ts` | Remove terminal Task/Run atomic coupling, terminal live-Run assertions, and `blockActiveRunForTask`. |
| `engine/task-agent-lifecycle.ts` | Traverse Task Session relationships and immutable dispatch-lineage edges; do not add Run or status-classified Goal attempts. |
| `engine/task-message-open.ts` | Reopen only the Task. Delete Run reopening. |
| `orchestrator/build-tool.ts` | Delete both lazy Run creation paths and Run activation. Use explicit task/Goal dispatch and result identities. |
| `orchestrator/visual-qa-stage.ts` | Persist report outcome and evidence-contract outcome as separate facts from exact report/evidence references; delete the active-Run lookup and exception. |
| `build/agent.ts` | Stop attaching a discovered Run ID to Build artifacts. |
| `task-api/index.ts` | Remove active/latest Run fallback, active-Run cancellation tests, and Run API output. |
| `workbench/board.ts` | Remove active/latest Run selection; project direct evidence. |
| `orchestrator/agent.ts` | Remove latest-Run prompt context and use selected Plan, Goal results, and acceptance artifacts. |

## Broader Call-Point Disposition

The original first-draft claim that one `runID` / `run_id` search reached 84
production files was not reproducible and missed renamed execution locks. The
implementation Recall must capture the output of each exact command below and
maintain a per-symbol, per-file disposition ledger:

```sh
git grep -n -E 'findActiveRunForTask|findLatestRunForTask|RunRow|EngineRunStatus|createRun\(|updateRun\(|listLiveRuns|activeRunBySession' HEAD -- packages/opencorvus/src packages/opencorvus/test
git grep -n -E 'ProjectedAgentExecutionLease|executionLease|goalConcurrency|goal_concurrency' HEAD -- packages
git grep -n -E 'taskLoopChain|taskLoopPasses|taskLoopLaunches|taskLoopCompletions|taskLoopQuiescence|runtime-state|loopInFlight|taskAborts' HEAD -- packages/opencorvus/src packages/opencorvus/test
git grep -n -E 'listLiveOrchestratorToolOwnership|findLiveDispatchOwnership|insertLiveDispatchOwnership|orchestrator_tool_ownership' HEAD -- packages/opencorvus/src packages/opencorvus/test
git grep -n -E '\brunID\b|\brun_id\b' HEAD -- packages/opencorvus/src packages/overlay packages/sdk packages/web
```

Current call points belong to these replacement families:

| Family | Current files | Disposition |
| --- | --- | --- |
| Run storage and lifecycle | `engine/catalog.ts`, `engine/engine.sql.ts`, `engine/model.ts`, `engine/store.ts`, `engine/writer.ts`, `engine/state.ts`, `engine/runtime.ts`, `engine/runtime-hooks.ts`, `engine/orphan.ts`, `engine/event-log.ts`, `engine/index.ts` | Delete the Run model, artifact kind, statuses, writers, queries, hooks, orphan observation, and events. |
| Execution admission and physical ownership | `engine/projected-agent-execution-lease.ts`, `orchestrator/dispatch-agent-tool.ts`, `orchestrator/dispatch-adapter-execution-context.ts`, `orchestrator/task-loop-control.ts`, `orchestrator/runtime-state.ts`, `engine/queue.ts`, `engine/pipeline.ts`, `session/prompt/state.ts`, Resolver/manifest `goal_concurrency` projection, and their tests | Delete projected-agent active/pending admission and duplicate currentness registries. Keep `goal_concurrency` as scheduler guidance only. Make the root-Session `SessionPromptState` queue the only physical wake-ordering/controller/completion source, plus the bounded destructive-operation scope. Delete unused `taskAborts`. |
| Execution-lease consumers | `agent/runner.ts`, `agent/outcomes.ts`, `architect/agent.ts`, `build/agent.ts`, `delegated-worker/agent.ts`, `explore/agent.ts`, `fact-check/index.ts`, `frontend-design/agent.ts`, `goal-workload-analyst/agent.ts`, `integrity/team-agent.ts`, `intent-analysis/agent.ts`, `requirements/agent.ts`, `research/agent.ts`, `orchestrator/architect-stage.ts`, `orchestrator/deep-research-stage.ts`, `orchestrator/frontend-research-stage.ts`, `orchestrator/integrity-review-stage.ts`, `orchestrator/requirements-stage.ts`, `orchestrator/tools.ts`, and `orchestrator/visual-qa-stage.ts` | Remove `executionLease` arguments, transfer, attach, freshness reread, and completion. Pass a frozen immutable dispatch identity/context containing only Task, projected agent, projection hash, work scope, tool identity, and dispatch-lineage writer callback. |
| Dispatch lineage and coordination | `engine/agent-coordination.ts`, `engine/cancellation-error.ts`, `engine/cancellation-scope.ts`, `engine/execution-abort.ts`, `engine/interaction-request.ts`, `engine/interaction.ts`, `engine/mailbox.ts`, `engine/ownership.ts`, `engine/protocol.ts`, `engine/task-agent-lifecycle.ts`, `engine/task-message-open.ts`, `engine/tool-ownership.ts` | Use exact Task, tool-call, Session, coordination-action, and Goal-attempt identities. Replace mutable ownership lifecycle rows with immutable dispatch-lineage edges; delete live ownership enumeration and inferred cancellation targets. |
| Goal/build/delivery | `engine/goal-evidence.ts`, `engine/persist.ts`, `engine/publisher.ts`, `engine/rewind.ts`, `orchestrator/build-contract-audit.ts`, `orchestrator/build-feedback.ts`, `orchestrator/build-tool.ts`, `orchestrator/goal-lifecycle-tools.ts`, `orchestrator/integrity-review-stage.ts`, `orchestrator/read-context-tool.ts`, `orchestrator/subagent-cancellation-runtime.ts`, `orchestrator/subagent-cancellation-tool.ts`, `orchestrator/tools.ts`, `build/agent.ts`, `build/evidence-manifest.ts` | Bind each artifact to Task, Plan, Goal attempt, dispatch tool call, Session, or acceptance candidate according to its actual scope. |
| Verification and acceptance | `acceptance/checks/contract-audit-review.ts`, `acceptance/checks/project-assessment.ts`, `acceptance/checks/types.ts`, `acceptance/contract-audit.ts`, `acceptance/manifest.ts`, `acceptance/specialist-review.ts`, `acceptance/specialists/backend-client.ts`, `acceptance/specialists/security-data.ts`, `acceptance/specialists/test-integration.ts`, `acceptance/visual-feedback-verification.ts`, `browser-preview/persist.ts`, `browser-preview/region-comparison.ts`, `integrity/acceptance-tools.ts`, `integrity/replay-context.ts`, `verification/persist.ts` | Replace Run scope with exact acceptance candidate, Goal-attempt, dispatch-lineage, Session, Browser Preview evidence artifact ID/capture SHA, and source-artifact references. |
| Metrics | `metrics/executor.ts`, `metrics/metrics.sql.ts`, `metrics/store.ts`, `metrics/types.ts` | Scope metric results to Task plus acceptance/verification or Goal-attempt ID; remove Run correlation. |
| API and projections | `engine/describe.ts`, `engine/docs.ts`, `engine/memory-bridge.ts`, `orchestrator/agent.ts`, `orchestrator/protocol/message-bridge.ts`, `server/routes/orchestrator.ts`, `server/routes/project.ts`, `task-api/index.ts`, `tool/request-orchestrator-decision.ts`, `workbench/board.ts`, `workbench/brief.ts`, `workbench/workbench.sql.ts` | Remove Run endpoints/fields and render existing first-class entities. |
| Storage-adjacent references | `engine/artifact.ts`, `project/runtime-id-lookup.ts`, `project/runtime-paths.ts`, `protocol/protocol.sql.ts`, `protocol/schema.ts`, `protocol/store.ts`, `scheduler/cron.sql.ts`, `session/compaction.ts`, `worktree/index.ts`, `engine/task-project-archive.ts` | Remove Task Run columns/paths. Keep only explicit Goal-attempt, Session, Task, artifact, scheduler-job, and worktree identities required by each domain. |
| Generated/public surfaces | `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/sdk.gen.ts`, `packages/sdk/js/src/gen/types.gen.ts`, `packages/web/src/content/docs/reference/api.mdx`, `packages/web/src/content/docs/zh-cn/reference/api.mdx`, Overlay services/debug/tests | Regenerate after the schema and route deletion; do not preserve compatibility aliases. |
| Same-name Expert Squad domain data | Generated and source MirrorTest package tools, including `assertMirrorTestRunID`, package-local `.opencorvus/**/runs/<runID>` paths, and `opentest-runner` `run_id` | Preserve. These IDs name an MirrorTest test execution, not an OpenCorvus Task Run. Core negative tests must target exact core symbols/fields/routes rather than ban the strings `runID` or `run_id` repository-wide. |

## Goal-Liveness And Ownership-Liveness Removal

| Current concept | Disposition |
| --- | --- |
| `LIVE_GOAL_RUN_STATUSES`, `ACTIVE_GOAL_RUN_STATUSES`, `isLiveGoalRunStatus`, `isActiveGoalRunStatus` | Delete. Goal attempt records have identity only; result artifacts carry outcome. |
| `goal-mutation-guard.ts` | Delete status/ownership admission. Orchestrator reasons from visible work; writes retain only schema/referential integrity validation. |
| `ProjectedAgentExecutionLease`, its active/pending pool, `executionLease` adapter arguments, and host `goal_concurrency` enforcement | Delete. Frozen capability identity/work scope stay ordinary dispatch input; `goal_concurrency` remains visible LLM scheduling guidance only. |
| `listLiveOrchestratorToolOwnership`, `findLiveDispatchOwnershipBySession`, `findLiveDispatchOwnershipByGoalRun`, `insertLiveDispatchOwnership` | Delete. Replace the lifecycle-shaped ownership artifact with immutable per-child dispatch-lineage edges. Cancellation resolves an exact Session ID from that edge. |
| `engine/lease.ts`, owner process-ID liveness, GoalRun orphan predicates | Remove from workflow control. Physical process cleanup uses exact SessionPrompt controller/resource ownership and cannot change Task/Goal outcomes. |
| Worktree `active` projection and garbage collection live checks | Replace with explicit worktree ownership plus explicit stop/delete settlement. An incomplete historical attempt cannot indefinitely preserve or delete a worktree by itself. |
| Queue waits behind live ownership | Delete. Awaited tool results and same-Session physical non-reentrancy provide the required host execution integrity without a Task/agent admission pool. |
| `taskLoopChain`, launch/pass/completion sets, `runtime-state.running`, and `loopInFlight` | Delete after moving wake ordering to the exact root-Session `SessionPromptState` queue. Durable wake rows remain pending until that queue completes their prompt; they are not classified by executor liveness. |

## Exact Route Disposition

The Task Run route family is deleted rather than aliased:

| Current route | Disposition |
| --- | --- |
| `GET /task/:taskID/runs` | Delete; Task conversation/board exposes Sessions, Goal attempts, results, evidence, and acceptance candidates directly. |
| `GET /run/:runID` | Delete. |
| `GET /run/:runID/brief` | Delete; retain `GET /task/:taskID/brief`. |
| `POST /run/:runID/abort` | Delete; retain exact Task and Task-Session cancellation routes. |
| `GET /run/:runID/acceptance` | Delete; acceptance candidate is addressed by immutable candidate ID through the Task projection. |
| `GET /run/:runID/diff` | Delete; diff belongs to the exact acceptance candidate. |
| `GET /run/:runID/artifacts` | Delete; artifacts are queried by Task and exact artifact scope. |
| `GET /run/:runID/evaluations` | Delete; evaluations reference exact verification/acceptance IDs. |

No compatibility route redirects these paths.

## Data Reset

The project is unreleased and explicitly forbids compatibility migrations.
Implementation therefore updates the current schema and resets the development
database through the existing current-schema reset path.

The new schema removes:

- Run artifact payload/schema and Run status catalog;
- `engine_artifact.run_id`;
- `engine_interaction_request.run_id`;
- protocol/event/metric/workbench Run columns;
- `coordinator_run_id` from Goal attempts;
- public `activeRunID`, Run API models, and generated Run endpoints/types.

The reset must not preserve old Run rows through a compatibility reader or
translate them into a renamed execution container. It also must not execute
against the currently running application automatically: schema activation and
database reset wait for a separate explicit restart/reset authorization.

## Implementation Sequence

### Slice 1 — Complete The Semantic Ledger And Negative Boundary

Land the exact per-symbol/per-file ledger for Task Run, renamed execution
currentness, physical SessionPrompt ownership, dispatch lineage, and same-name
Expert Squad domain runs. Add source-boundary tests that distinguish core Task
Run from MirrorTest's test-run identity.

Acceptance: every current call point has one declared delete/replace/preserve
disposition, including execution lease and task-loop currentness sources.

### Slice 2 — Remove Run Currentness From Outcomes

Atomically replace Visual QA finalization, immutable acceptance-candidate
construction, delivery, and metrics consumption so they use exact artifact
references. Keep historical Run storage temporarily as a non-authoritative
audit input only within this slice; no code may query current/latest Run to
submit a report or choose acceptance inputs.

Acceptance: the original `no active run` path is absent, report outcome and
evidence-contract outcome are distinct, and Visual QA/delivery/metrics tests
pass in the same commit.

### Slice 3 — Replace Dispatch Control And Goal Liveness

Create immutable dispatch-lineage edges; update worker descriptors,
coordination actions, cancellation, and UI projection to consume those edges;
delete mutable ownership lifecycle queries; delete
`ProjectedAgentExecutionLease`, all adapter/runner `executionLease` arguments,
the active/pending pool, and host `goal_concurrency` enforcement. Remove Goal
attempt live status control and Goal mutation admission.

Retain only the exact `SessionPromptState` controller/completion source and a
single root-Session wake queue plus one bounded stop/delete
destructive-operation scope. Fold necessary ordering into that queue and delete
`taskLoopChain`, pass/launch/completion sets, runtime-state running maps,
`loopInFlight`, and unused `taskAborts` so they cannot remain parallel sources.

Acceptance: ordinary dispatch/wake/report/mutation never waits for a host
execution lease or durable liveness row; exact cancellation and stop-before-
delete race tests pass; simultaneous Task wakes persist distinct wake IDs and
execute sequentially through the one root-Session queue without refusal or
loss.

### Slice 4 — Remove Task Run Storage And Public Contract

Delete the Run schema, status catalog, artifact writer/query/event surface,
terminal Task coupling, core `run_id` columns, route family, API/Overlay
projection, and generated public contract. Re-scope every remaining core
artifact to Task, Goal attempt, dispatch lineage, Session, verification, or
acceptance candidate. Preserve Expert Squad package-local run identities.
In this same atomic slice, first replace interaction wake scope, move terminal
Goal-result refill creation into the result writer, delete
`EngineRuntime.monitorRuns` / `syncRun` / Run blockers / Run orphan
observation, and remove every remaining Run consumer; only then remove the
schema/types/routes and regenerate public contracts. Update current
architecture documents in the same commit.

Acceptance: production code contains no `findActiveRunForTask`,
`findLatestRunForTask`, `isLiveRunStatus`, `LIVE_RUN_STATUSES`,
`RUNTIME_ACTIVE_RUN_STATUSES`, `activeRunBySession`, `createRun`, `updateRun`,
`RunRow`, or Task `activeRunID`.

### Slice 5 — Prove Absence And Perform Real Replay

Run the full exact-symbol ledger again, remove any non-Run dead code exposed by
the refactor, and perform the real Mirror Design replay. This slice must not
contain deferred consumers of a contract deleted in Slice 4.

Acceptance: there is no polling or status scan that decides whether the
Orchestrator may run; restart cannot leave a durable row capable of locking a
Task; the repository compiles at every preceding slice; and real visual
evidence proves the original failure path is gone.

## Required Tests

### Negative architecture tests

- OpenCorvus core production source contains none of the deleted Task
  Run/liveness symbols; package-owned MirrorTest run identity remains intact.
- No status enum/predicate is used by dispatch, Goal mutation, Task wake,
  finalizer submission, Task completion, retry, or acceptance admission.
- `ProjectedAgentExecutionLease`, its pool/waiters/terminal transfer, and every
  adapter/runner `executionLease` argument are absent.
- `goal_concurrency` is visible scheduling guidance and has no host admission
  consumer.
- No API, OpenAPI, Software Development Kit, Overlay, prompt, or current
  architecture document exposes `activeRunID` or instructs a caller to obtain
  an active Run.
- No compatibility alias maps Run to a renamed task-attempt concept.

### Behavioral tests

- A Task with an incomplete historical Goal attempt accepts a new operator
  wake, Goal edit, retry, and worker dispatch.
- A Task restart with incomplete historical artifacts does not require cleanup
  before Orchestrator reasoning resumes.
- Concurrent wakes for one Task persist distinct wake IDs, enter the exact
  root-Session prompt queue, execute sequentially, and survive process
  interruption without a Task-level active/current registry.
- Parallel `dispatch_agent` calls retain separate tool calls, immutable
  dispatch-lineage edges, Sessions, results, and evidence without a task-wide
  owner or execution lease.
- Exact-session cancellation stops the owned current-process prompt; an absent
  or foreign-process controller reports unresolved physical ownership,
  preserves records, and does not mutate historical outcomes.
- Stop racing an operator wake or child Session creation holds the bounded
  destructive-operation scope, settles every exact controller, and permits
  deletion only after no new execution can enter. Non-destructive Task
  operations never consult that scope.
- Direct Build and Goal Build both produce consumable changed-file and
  verification artifacts without Run.
- Interaction resolution wakes its Task without Run.
- Goal terminal result writes one refill wake fact without a monitor scan.
- Task completion writes no secondary execution terminal state.
- Visual QA PASS, Visual QA FAIL, invalid evidence, and execution failure remain
  four distinct observable outcomes.
- Reference-parity Visual QA persists verification using exact Task, Session,
  report tool call, preview target, Browser Preview evidence IDs, and capture
  SHAs without a new current-snapshot entity.
- The generic Browser Preview route remains task/target scoped and never
  invents execution lineage.

### Validation commands

- Focused Engine, queue, cancellation, interaction, Goal-attempt, Build,
  Visual QA, Browser Preview, acceptance, metrics, Task API, and Overlay tests.
- `bun run typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- repository-native OpenAPI/Software Development Kit generation and clean-diff
  verification.
- A real isolated Mirror Design task replay with Browser Preview/Playwright
  screenshots and visual inspection. Mocked evidence cannot satisfy this item.

## Implementation Record

Implementation completed on 2026-07-24 as a direct replacement:

- Task Run storage, models, statuses, routes, generated Software Development
  Kit types, public documentation, Overlay projections, and core `run_id`
  correlation were deleted. No compatibility route, alias, or renamed
  task-wide attempt container remains.
- `ProjectedAgentExecutionLease`, mutable dispatch ownership,
  Goal-attempt liveness predicates, goal mutation admission, task-loop
  currentness registries, and termination/runtime registries were deleted.
- `engine/dispatch-lineage.ts` now records immutable visible tool-call to child
  Session edges. Goal attempt identity is immutable; producer results and
  workspace bindings are separate facts.
- `SessionPromptState` owns the exact prompt controller and the ordered
  root-Session wake queue. Task cancellation traverses the real Session tree.
  Delete, archive, cancellation, and rewind use one exact root-Session
  destructive scope. `Session.createNext` checks the complete parent lineage
  immediately before insertion, so a dispatch cannot create a child after
  cancellation enumeration. The scope remains bounded to irreversible
  operations and is not an ordinary scheduling gate.
- Ownerless `SessionStatus` projections are neither rewritten nor accepted as
  physical execution ownership. A prompt controller found outside its
  persisted Session directory produces
  `TaskCancellationIncompleteError` instead of inferred success.
- Worktree garbage collection preserves paths named by each Goal's newest
  immutable `goal_workspace_binding`; it does not classify a Goal attempt as
  live.
- Visual QA report outcome and visual evidence-contract outcome are separate.
  Verification records the exact judgment tool message/part/call, final
  message, preview target, Browser Preview evidence IDs, and capture digests.
  Invalid evidence persists a failed contract artifact with issues while the
  specialist report remains accepted; it does not throw or rewrite the
  specialist Session as aborted.
- `acceptance_candidate` freezes the selected Plan, exact Goal attempt result
  artifact IDs, task-scoped result artifact IDs, changed-file artifact IDs,
  and verification artifact IDs when the Orchestrator completes a Task.
  Publisher consumes that exact candidate ID and no longer re-reads the
  current worktree or Git state.
- `engine_task.acceptance_candidate_id` records the exact immutable candidate
  chosen by the terminal `complete_task` decision. Board, Task Progress, and
  Orchestrator context read only that bound ID. Retry, replan, and an operator
  wake that reopens a terminal Task clear the binding before a new Task pass.
  They never choose the latest candidate.
- Per-Goal `acceptance-goal_attempt` artifacts remain Goal/Integrity facts.
  They cannot be written without `goal_attempt_id` and cannot be promoted to
  Task delivery. The dead Task acceptance writer, Task evaluation updater,
  `acceptance.ready`, `evaluation.completed`, their event-log/UI consumers,
  and the Task acceptance/evaluation API projections were deleted. Channel
  notifications consume the real `task.completed` event.
- Verification exposes only exact Goal-attempt evidence readers. The generic
  Task-latest `acceptance` evidence scope, writer, and query surface were
  deleted; Task completion freezes exact verification artifact IDs into the
  bound acceptance candidate instead.
- Goal-attempt projections no longer contain blocker, retry-intent,
  superseded-reason, superseded-time, or `needs_redispatch` compatibility
  fields. Retry remains an explicit Orchestrator decision creating a new
  immutable attempt.
- Package-owned MirrorTest test-run IDs remain intact. Browser runtime state,
  Server-Sent Events replay activity, Hypertext Markup Language `aria-live`,
  and operating-system process reachability remain physical or presentation
  concepts and are not Task-execution admission sources.

### Implementation validation

| Validation | Result |
| --- | --- |
| Exact production/public deleted-symbol scan | Passed: zero matches for Task Run, active/latest Run, execution lease, mutable ownership, task-loop currentness, `taskAborts`, `taskLoopIdleTimeoutMs`, and public `activeRunID` symbols. |
| Full repository typecheck | Passed: 9 package tasks successful. |
| API route inventory | Passed: 6 rules across 32 files. |
| Generated API documentation check | Passed: 285 operations across 24 groups. |
| Overlay locale contract | Passed: the panel locale inventory has no missing or unused keys after deleting the retired Acceptance and Integrity projections. |
| Historical documentation links | Passed: 21 tests. |
| Orchestrator and specialist output contracts | Passed: 101 orchestrator-tool tests use the exact current Build, Requirements, Architect, FrontendDesign, Visual QA, and Integrity outputs. The old `output.result`, `output.report`, and default-field compatibility wrappers are absent. |
| Core architecture tests | Passed: Task Run/liveness absence, immutable Goal attempts, and root-Session wake ordering/destructive scope. |
| Task cancellation and deletion | Passed: exact controller timeout, root wake settlement, queue settlement, stale status non-ownership, and atomic queue/session deletion. |
| Worktree garbage collection | Passed: 9 tests including newest immutable workspace binding retention. |
| Metrics and Workbench | Passed: exact verification artifact selection and direct outcome projection without Task Run. |
| Immutable Task acceptance | Passed: exact terminal candidate binding, wrong-Task rejection, later unbound candidate exclusion, Board/Progress removal of legacy Task acceptance/evaluation projections, retry/operator-reopen binding clear, Goal-attempt-only verification evidence, and `complete_task` publish/bind identity. |
| Channel completion projection | Passed: Channel Runtime and Slack consume `task.completed`; obsolete `acceptance.ready` and `evaluation.completed` production/public symbols have zero matches. |
| Overlay visual acceptance | Passed in an isolated Node/Playwright fixture at 1280×860 and 760×820. The exact candidate/Plan and artifact counts render without horizontal overflow; screenshots are `.scratch/acceptance-candidate-exact-desktop.png`, `.scratch/acceptance-candidate-exact-narrow.png`, and `.scratch/acceptance-candidate-exact-narrow-bottom.png`. The running application and sidecars were not touched. |
| Combined architecture regression | Passed: 137 tests across immutable acceptance publishing, Goal-attempt evidence ordering, orchestrator tools, execution-liveness retirement, immutable Goal attempts, root wake ordering, Visual QA evidence separation, and exact verification metrics. |
| Documentation health | Passed: 21 historical-link tests and 61 document-health tests in the target split; the current consolidated command reports 82 passing tests across both files. The health inventory follows the renamed visible-final-message browser fixture and contains no stale deleted-file path. |
| Independent final implementation review | `ACCEPT`: no blocking architectural residual found. The reviewer independently repeated typecheck, API/docs checks, the 137-test architecture suite, and the isolated Node/Playwright acceptance panel. |
| Version-control delivery | Pushed commits `b9a6ebc52` (`dsw-33987 retire execution liveness and Task Run`) and `d0d15883d` (`dsw-33987 remove retired acceptance locale keys`) to `legacy-remote/v0.0.17beta` with all pre-push hooks enabled. |
| Real Mirror replay | Not executed against the running application. The new schema/binary is not active until a separately authorized restart; this implementation did not restart, stop, refresh, or reload OpenCorvus, Overlay, or any sidecar. |

The working tree also contains an independently authored output-tool/stage
refactor. Its production contracts were preserved and its stale orchestrator
fixtures were rewritten to the exact new outputs rather than hidden behind
compatibility wrappers. Full typecheck and the 101-test orchestrator tool suite
are green. This still does not substitute for the restart-gated real Mirror
replay.

## Completion Criteria

The refactor is complete only when:

1. Task Run, projected-agent execution leases, ordinary-operation liveness
   admission, and duplicate currentness registries are absent from OpenCorvus
   core production and public contracts.
2. No stale durable row can prevent ordinary Task/Goal/worker/report activity.
3. Physical cancellation addresses exact SessionPrompt controllers through
   immutable dispatch lineage; stop/delete has one bounded concurrency seal.
4. Evidence and acceptance use immutable explicit references rather than
   currentness inference.
5. Expert Squad prompts and workflows remain domain-only; `goal_concurrency`
   is guidance rather than host admission, MirrorTest keeps its own test-run
   identity, and no squad compensates for infrastructure identity defects.
6. Focused tests, full typecheck, API/docs checks, generated-contract checks,
   and the real visual replay pass.
7. Changes are committed with the `dsw-33987` prefix and pushed to
   `legacy-remote/v0.0.17beta`.
8. No running OpenCorvus, Overlay, or sidecar process is restarted without a
   separate explicit user request.
