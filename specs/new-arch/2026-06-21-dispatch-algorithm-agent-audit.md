# Dispatch Algorithm / Agent Boundary Audit

Date: 2026-06-21

## Objective

Run a careful adversarial audit of OpenCorvus scheduling, orchestrator, and
agent contracts. Only high-confidence findings may be fixed directly; low
confidence concerns are recorded for human review. Each fix must preserve a
clear execution-flow explanation, focused regression coverage, and a clean
commit/push trail.

## Recalled Constraints

- `AGENTS.md` requires no fallback logic, no gate-style bypass, no blind patching,
  and no broad git reset.
- Existing design records must be recalled before edits.
- Scheduling bugs must be explained as an execution chain, not as a final
  surface status such as `cancelled`, `aborted`, or `timeout`.
- Frontend/UI work requires visual verification. This audit is currently
  scheduler/agent logic only; no UI surface has been modified in this round.
- High-confidence dead code may be removed only when call-site evidence proves
  it is not used. Low-confidence cleanup candidates stay in this file.

## Benchmark Definition

Focused checks for this audit round:

- Orchestrator / scheduler / goal execution: targeted tests under
  `packages/opencorvus/test/orchestrator`, `test/engine`, and `test/scheduler`.
- Agent tool/schema contract: targeted tests under `test/agent`,
  `test/frontend-design`, `test/frontend-research`, `test/research`, and
  `test/orchestrator/orchestrator-tool-descriptions.test.ts`.
- Context pressure: `test/session/compaction-dispatch-anchor.test.ts` and
  `test/session/compaction.test.ts`.
- Whole-package safety: `bun run --cwd packages/opencorvus typecheck`.
- Pre-push safety: repository pre-push hook (`check:sdk-imports`,
  `check:ai-runtime`, `turbo run typecheck`, `api:routes-check`, `docs:check`,
  overlay i18n, secret scan).

Timeout strategy: use commands that emit normal test progress; treat lack of
process activity as the timeout signal instead of a fixed wall-clock cutoff.

## Current Baseline

- Previous high-confidence frontend-design/frontend-research/compaction fixes
  were committed and pushed as `a911e71a2b fix: harden frontend handoff agents`.
- `packages/opencorvus/src/provider/models-snapshot.ts` remains dirty from
  `bun run build:overlay` generation and is not part of this audit baseline.

## Independent Audit Lanes

| Lane | Scope | Status |
| --- | --- | --- |
| A | scheduler / goal runner / orchestrator execution flow | running |
| B | agent definitions / tool schema / terminal finalizer recovery | running |
| C | agent responsibility boundaries / handoff purpose / dead code | running |

## Findings

| ID | Confidence | Status | Finding | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| SCHED-001 | high | fixed, tested | `TaskQueueService.recover()` marked stale `running` rows failed in SQLite but could not release the corresponding in-memory hung Promise because `inFlight` stored a bare `Set<Promise<void>>`. Any later `runNow()` then waited forever on a task that the durable queue had already declared terminal. | `packages/opencorvus/src/scheduler/task-queue-service.ts`; regression test `recovery releases stale in-flight prompt promises that stop producing activity` simulates a prompt Promise that never resolves and emits no activity. `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts` passed 19/19. | Changed `inFlight` to a task-id keyed map with a progress-listener cleanup hook; stale recovery now removes and cleans that in-memory record when it writes the terminal DB status. |
| SCHED-002 | high | fixed, tested | Stale queue recovery failed the durable `running` row and released the queue's local `inFlight` listener, but did not cancel the corresponding live `SessionPrompt` loop. After recovery removed the durable `running` blocker, the next same-session queued task could be claimed while the old prompt loop still owned `SessionPromptState` for that session directory. | Independent lane A traced `recover()` in `packages/opencorvus/src/scheduler/task-queue-service.ts`, `pending()` same-session exclusion, `SessionPrompt.loop()` directory-scoped state in `packages/opencorvus/src/session/loop.ts`, and `SessionPromptState.cancel()` in `packages/opencorvus/src/session/prompt/state.ts`. Regression `recovery releases stale in-flight prompt promises that stop producing activity` now asserts recovery calls `SessionPrompt.cancel(session.id, session.directory)`. Focused test, full `task-queue-service.test.ts` 19/19, and `packages/opencorvus` typecheck passed. | `recover()` now fetches the owning session, uses a CAS-style `returning()` update so cancellation only follows a successful stale-row terminal write, calls `SessionPrompt.cancel` with the session directory, then releases the in-flight cleanup and publishes the visible terminal error. |
| AGENT-001 | high | fixed, tested | `deep_research`, `workload_analysis`, and `visual_qa` wrapped terminal-tool agents but did not expose `continuation_artifact_id`, did not consistently capture the child session id, or did not pass `continuation` to `runAgentSession`. A terminal finalizer miss therefore either threw away same-session recovery context or would have emitted an invalid continuation tool name. | Independent lanes B/Hubble and Confucius audited `orchestrator/tools.ts`, `research/agent.ts`, `goal-workload-analyst/agent.ts`, and `visual-qa/agent.ts`. Regressions `deep_research terminal finalizer miss returns same-session continuation`, `workload_analysis terminal finalizer miss returns same-session continuation`, and `visual_qa terminal finalizer miss returns same-session continuation` passed, along with the existing `frontend_research` continuation test. `orchestrator-tool-descriptions.test.ts` and package typecheck passed. | Wired `continuation_artifact_id`, `continuationFromArtifact`, `continuationResultForTerminalFinalizerMiss`, `runnerSessionID`, and agent `continuation` through those three wrappers. Corrected continuation tool names for `deep-research`, `goal-workload-analyst`, and `intent-analysis`. |
| AGENT-002 | high | fixed, tested | `frontend_design` accepts `continuation_artifact_id` together with fresh visual scope fields (`urls`, `figma_url`, `materials`) and then silently drops the fresh scope in continuation mode. | Independent lane B traced `FrontendDesignInputSchema` and continuation execution in `packages/opencorvus/src/orchestrator/tools.ts`; `frontend_research` already has an exactly-one guard for the comparable URL/continuation case. `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` passed 8/8. | Added schema rejection for continuation plus fresh visual scope fields and regression assertions in `orchestrator-tool-descriptions.test.ts`. |
| AGENT-003 | high | fixed, tested | `frontend_research.source_urls` advertised multiple URLs, but the evidence/output/prompt contract is single-page and only consumed the first URL. | Independent lane C traced `source_urls` through `orchestrator/tools.ts`, `research/agent.ts`, `webpage-prd-evidence.ts`, `webpage-evidence.ts`, `research/output-tools.ts`, `research/schema.ts`, and `research/prompt-section.ts`. `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` passed 8/8. | Constrained `source_urls` to exactly one URL and updated the tool description to call `frontend_research` separately for additional pages. |
| AGENT-004 | high | fixed, tested | Deep research and frontend research evidence refs merged as bare IDs, so duplicate `ev_1` IDs across briefs became ambiguous but still validated. | Independent lane C traced `research/prompt-section.ts`, `requirements/agent.ts`, `requirements/output-tools.ts`, and `research/schema.ts`. Focused requirements, research persistence, architect output-tools tests, and `packages/opencorvus` typecheck passed. | Downstream research evidence refs are now source-qualified as `deep_research:<id>` or `frontend_research:<id>`. Requirements and Architect validation reject bare ambiguous refs. |
| ORCH-001 | high | fixed, tested | `restart_from_stage("executor")` exposes deleted scheduler/tool action names such as `submit_execution` / `create_run` as continuation facts. | Independent lane C traced `orchestrator/scheduler.ts`, `orchestrator/tools.ts`, `agent/agent.ts`, and `test/orchestrator/scheduler.test.ts`. `bun test packages/opencorvus/test/orchestrator/scheduler.test.ts` passed 7/7. | Changed executor restart continuation facts to current tool semantics (`build` with active plan, `architect` without active plan) and removed fake `nextAction(runID)` formatting. |
| GOAL-001 | high | fixed, tested | Goal build background finalization errors can be swallowed, leaving a permanent live `goal_run` that blocks retry and terminal refill. | Independent lane A traced goal build async finalization in `orchestrator/tools.ts`, persistence in `engine/persist.ts`, runtime refill in `engine/runtime.ts`, and live-run dedupe. Targeted tests `goal build returns started after binding goal_run and finalizes in the background` and `goal build background finalize failure does not leave a live goal_run` both passed. | If `finalizeBuildAttempt` throws while the goal_run is still live, the build tool now marks that goal_run failed and records the finalization error instead of leaving it running. |
| REVIEW-003 | low | human review | Queued task path may report `started` even when `advanceQueue(cwd)` cannot start due to an active owner. | Independent lane A traced `engine/queue.ts`; production impact depends on terminal refill path. | Review after current high-confidence fixes. |
| REVIEW-004 | low | human review | `findActiveRunForTask` name implies active but implementation returns newest run. | Independent lane A traced `engine/store.ts`; key runtime callers have ID guard. | Rename/contract cleanup only after call-site audit. |
| REVIEW-005 | low | human review | Terminal goal refill wake fact insertion is not obviously atomic across public concurrent `syncRun` / `syncTask` calls. | Independent lane A traced `engine/runtime.ts`; production concurrency not confirmed. | Needs concurrency model confirmation. |
| REVIEW-006 | low | human review | Integrity direct evidence tools do not include a dedicated `frontend_research` section. | Independent lane C traced integrity team/acceptance tools; visual QA already consumes frontend research. | Product/reviewer responsibility clarification needed. |
| REVIEW-007 | low | human review | `frontend-design` static/session tool lists differ. | Independent lane C traced runtime injection and static list; difference may be intentional. | No code change without contract decision. |
| REVIEW-008 | low | human review | `continuationToolName` contains names not matching all current orchestrator tool names. | Independent lane C noted current active call sites only cover existing fixed agents. | Revisit during broad finalizer recovery repair. |
| REVIEW-009 | medium | human review | Several older `tools.test.ts` goal-build tests seed tasks under synthetic project ids, so filtered runs such as `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build"` fail with `Task not found in current project`. | During GOAL-001 verification, the new targeted test and the adjacent normal-finalization test passed after using `Instance.current().project.id`; the wider name-filtered subset still exposed older fixtures with the same mismatch. | This is a test-fixture reliability issue, not part of the GOAL-001 runtime fix. Needs a separate mechanical fixture cleanup across affected tests. |
| AGENT-005A | high | fixed, tested | `fact_check` is a terminal-tool agent but did not expose same-session recovery when it ended without `report_fact_check_result`. A naive retry would start a fresh verifier session, while a naive continuation could retarget the latest assistant message instead of the failed attempt's original snapshot. | Sartre independently audited the `fact_check` wrapper and confirmed `StageContinuationStage` already includes `fact-check`, `continuationToolName()` maps it to `fact_check`, and `FactCheckAgent.run()` already has terminal tool `report_fact_check_result`. Regression `[I] terminal finalizer miss persists tool_error before same-session continuation` verifies first-call `tool_error` persistence, stage-continuation artifact scope, second-call continuation, and final completed-cache behavior. `orchestrator-tool-descriptions.test.ts`, `fact-check/orchestrator-tool.test.ts`, `packages/opencorvus` typecheck, and `git diff --check` passed. | Added exact fresh-vs-continuation schema, persisted the original snapshot in `normalized_stage_input`, made continuation-only calls use that snapshot as the single source of target data, passed `AgentSessionContinuation` into `FactCheckAgent.run`, and preserved the existing synthetic `tool_error` artifact before returning the continuation pointer. |
| AGENT-005B | high | fixed, tested | `integrity` is a terminal-tool agent but did not expose same-session recovery when it ended without `submit_integrity_consensus`. A schema-only fix would have been wrong because integrity also owns task-level orchestrator tool ownership while the child session runs. | Wegener independently audited `integrity` and confirmed `StageContinuationStage` includes `integrity`, but the `integrity` tool only exposed `reason`, `reviewIntegrity` did not accept `continuation`, and ownership/session lifecycle must be reopened for continuation because `runAgentSession` does not call `onSessionCreated` when resuming an existing session. Regression `integrity terminal finalizer miss returns same-session continuation with ownership closed` verifies continuation artifact scope, no missing-finalizer `integrity_attempt`, one final artifact after continuation, and no live ownership leaks. `team-agent.test.ts`, orchestrator schema tests, the targeted orchestrator wrapper test, `packages/opencorvus` typecheck, and `git diff --check` passed. | Added `continuation_artifact_id`, passed `AgentSessionContinuation` through `reviewIntegrity`, reopened ownership for resumed sessions, closed ownership on both finalizer-miss and completed continuation paths, and persisted `active_spec_snapshot_id` / phase / goal ids in `normalized_stage_input` with a hard scope check before resuming. |
| AGENT-008 | high | fixed, tested | `fact_check` emitted `workflow.step.updated` running for workflows containing a `tool: "fact_check"` step, but none of its return paths emitted completed or failed. Custom workflow board replay could therefore leave the fact-check step visually running after cached, rejected, continuation, tool-error, or successful exits because `taskStepStatusByTool()` has no persistent `fact_check` projection. | Independent lane B traced `trackStepStart("fact_check")` in `packages/opencorvus/src/orchestrator/tools.ts`, the missing `trackStepComplete("fact_check")`, and `findStepByTool()` custom workflow binding. `fact-check/orchestrator-tool.test.ts` now verifies live workflow events for normal completed, cached completed, target-streaming rejection failed, and terminal-finalizer-miss continuation failed. Full fact-check orchestrator tool test 10/10 and `packages/opencorvus` typecheck passed. | Wrapped the fact-check tool body in a scoped `try/finally` that emits `trackStepComplete("fact_check", failed)` on every exit. The step defaults to failed; cached and completed agent outcomes set it to completed before returning. |
| AGENT-006 | medium | human review | `analyze_intent` has `StructuredOutputError` recovery represented in `StageContinuationFailureName`, but no orchestrator continuation path. | Hubble traced `StageContinuationFailureName = "TerminalToolMissingError" | "StructuredOutputError"` and `analyze_intent` structured-output usage. This is not a terminal finalizer miss and should not be repaired by the terminal-tool helper without a separate structured-output continuation design. | Human/next-round review. Avoid adding fallback-style broad catch behavior. |
| AGENT-007 | medium | human review | `build` does not participate in generic stage continuation and instead converts missing `report_build_result` into build-specific failure/retry evidence. | Confucius noted `StageContinuationStage` excludes `build`; `BuildAgent` already maps missing terminal report into `BuildAgentContractError(missing_terminal_report)`. | Requires a product decision: same-session build continuation might conflict with current goal-run/worktree ownership semantics. Do not change in this batch. |
| REVIEW-001 | low | human review | Stage continuation claim reads artifact before update; concurrent multi-process claim behavior is unclear. | Independent lane B noted `engine/stage-continuation.ts` lacks obvious compare-and-swap. | Deployment concurrency model needs confirmation before code change. |
| REVIEW-002 | low | human review | `frontend_research` allows `continuation_artifact_id` together with fresh `focus`; unclear whether `focus` is diagnostic or part of scope. | Independent lane B traced `frontend_research` schema and runner behavior. | Product/tool contract clarification needed before code change. |
| TBD | - | collecting | Waiting for independent audit results. | - | - |

## Progress Log

- Created this audit ledger after committing the prior verified frontend-agent
  hardening batch.
- Spawned three independent read-only audit agents for scheduling, tool/schema,
  and responsibility/dead-code surfaces.
- Main-thread audit found `SCHED-001` before independent agents returned; applied
  the structural queue-state fix and added a regression test.
- Independent lane B returned two high-confidence agent/tool contract issues and
  two low-confidence review items. High-confidence items are recorded as
  `AGENT-001` / `AGENT-002`; low-confidence items are recorded for human review.
- Independent lanes A and C returned additional high-confidence goal/orchestrator
  and research-contract findings. Registered them as `GOAL-001`, `ORCH-001`,
  and `AGENT-003` / `AGENT-004`; low-confidence items are recorded for review.
- Applied schema-level fixes for `AGENT-002` and `AGENT-003`; focused
  orchestrator tool schema tests and `packages/opencorvus` typecheck passed.
- Applied `ORCH-001` restart handoff cleanup; focused scheduler tests and
  `packages/opencorvus` typecheck passed.
- Applied `GOAL-001` background finalization failure repair; targeted normal and
  failure-path goal build tests plus `packages/opencorvus` typecheck passed.
- Applied `AGENT-004` scoped research evidence-ref contract repair. Deep and
  frontend research brief internals still use local evidence ids, but prompt
  projections and downstream Requirements/Architect registration now use
  source-qualified refs. Verified with `requirements/output-tools-evidence`,
  `research/persist-describe`, full `architect/output-tools`, and
  `packages/opencorvus` typecheck.
- Applied the first `AGENT-001` finalizer-recovery repair batch for
  `deep_research`, `workload_analysis`, and `visual_qa`. Verified same-session
  continuation artifact creation and second-call continuation for each wrapper,
  plus schema exposure and package typecheck. Full `tools.test.ts` still fails
  on the previously recorded `REVIEW-009` project-id fixture mismatch, so that
  fixture cleanup remains a separate follow-up.
- Applied `AGENT-005A` for `fact_check`. The wrapper now supports exact fresh
  or continuation modes, stores the failed attempt's original target
  message/hash in the continuation artifact, persists the existing synthetic
  `tool_error` attempt before returning a continuation pointer, and resumes the
  same fact-check session without re-snapshotting the worker output. Verified
  with `fact-check/orchestrator-tool.test.ts`, orchestrator tool schema tests,
  `packages/opencorvus` typecheck, and `git diff --check`. `AGENT-005B`
  (`integrity`) remains the next high-confidence fix because ownership semantics
  need a separate targeted patch.
- Applied `AGENT-005B` for `integrity`. The integrity tool now exposes
  `continuation_artifact_id`, records active spec / phase / goal ids in the
  continuation artifact, refuses continuation if that scope has drifted, and
  reopens/closes task-level tool ownership around resumed integrity sessions.
  Verified with full `integrity/team-agent.test.ts`, targeted orchestrator
  wrapper coverage, orchestrator tool schema tests, `packages/opencorvus`
  typecheck, and `git diff --check`.
- Applied `SCHED-002` for stale prompt-loop cancellation. Durable stale-row
  recovery now fetches the owning session, performs a CAS-style terminal write,
  calls `SessionPrompt.cancel(session.id, session.directory)` on successful
  recovery, then releases queue-local in-flight cleanup. Verified with the
  focused stale in-flight regression, full `task-queue-service.test.ts` 19/19,
  and `packages/opencorvus` typecheck.
- Applied `AGENT-008` for `fact_check` workflow step closure. The tool now
  always emits a terminal workflow-step event after starting a matching
  custom workflow step: failed by default, completed for cached or completed
  agent outcomes. Verified normal, cached, early reject, and terminal-finalizer
  continuation paths in `fact-check/orchestrator-tool.test.ts` 10/10 and
  `packages/opencorvus` typecheck.
