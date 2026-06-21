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
| SCHED-003 | high | fixed, tested | Terminal goal refill sync dispatched one orchestrator wake per terminal goal run in the same parent run. A task with two completed goals could therefore self-wake twice in one runtime observation even though one orchestrator turn can read all refill facts, directly wasting tokens and producing duplicate scheduler churn. | Independent lane A traced `syncTerminalGoalRefills()` in `packages/opencorvus/src/engine/runtime.ts` and the regression test that expected two `runTaskLoop` calls for two terminal goal runs in `runtime-goal-run-convergence.test.ts`. `runtime-goal-run-convergence.test.ts` 14/14 and `packages/opencorvus` typecheck passed. | Runtime now collects all unreported terminal goal refill facts first, starts or queues one task-loop wake, then records one durable fact per terminal goal run with the shared dispatch result. |
| SCHED-004 | high | fixed, tested | The passive restart/zombie test and task-api liveness comments still described the retired no-live-goal batch wake contract. That stale contract could mislead a future scheduler repair into restoring the old batch wake path instead of the selected terminal-goal refill facts. | Independent lane A/Avicenna traced `zombie-task-revive.test.ts`, `task-api/index.ts`, `engine/runtime.ts`, and the selected `2026-06-19-goal-fifo-refill-scheduling-impact.md` contract. `zombie-task-revive.test.ts` 2/2, `runtime-goal-run-convergence.test.ts` 14/14, and `packages/opencorvus` typecheck passed. | Updated the restart-resume test to assert terminal refill facts and negative assertions for `noLiveGoalWakeFingerprint` / `syncNoLiveGoalRuns`; updated task-api comments to describe the narrow runtime observer instead of no-live batch settlement. |
| AGENT-001 | high | fixed, tested | `deep_research`, `workload_analysis`, and `visual_qa` wrapped terminal-tool agents but did not expose `continuation_artifact_id`, did not consistently capture the child session id, or did not pass `continuation` to `runAgentSession`. A terminal finalizer miss therefore either threw away same-session recovery context or would have emitted an invalid continuation tool name. | Independent lanes B/Hubble and Confucius audited `orchestrator/tools.ts`, `research/agent.ts`, `goal-workload-analyst/agent.ts`, and `visual-qa/agent.ts`. Regressions `deep_research terminal finalizer miss returns same-session continuation`, `workload_analysis terminal finalizer miss returns same-session continuation`, and `visual_qa terminal finalizer miss returns same-session continuation` passed, along with the existing `frontend_research` continuation test. `orchestrator-tool-descriptions.test.ts` and package typecheck passed. | Wired `continuation_artifact_id`, `continuationFromArtifact`, `continuationResultForTerminalFinalizerMiss`, `runnerSessionID`, and agent `continuation` through those three wrappers. Corrected continuation tool names for `deep-research`, `goal-workload-analyst`, and `intent-analysis`. |
| AGENT-002 | high | fixed, tested | `frontend_design` accepts `continuation_artifact_id` together with fresh visual scope fields (`urls`, `figma_url`, `materials`) and then silently drops the fresh scope in continuation mode. | Independent lane B traced `FrontendDesignInputSchema` and continuation execution in `packages/opencorvus/src/orchestrator/tools.ts`; `frontend_research` already has an exactly-one guard for the comparable URL/continuation case. `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` passed 8/8. | Added schema rejection for continuation plus fresh visual scope fields and regression assertions in `orchestrator-tool-descriptions.test.ts`. |
| AGENT-003 | high | fixed, tested | `frontend_research.source_urls` advertised multiple URLs, but the evidence/output/prompt contract is single-page and only consumed the first URL. | Independent lane C traced `source_urls` through `orchestrator/tools.ts`, `research/agent.ts`, `webpage-prd-evidence.ts`, `webpage-evidence.ts`, `research/output-tools.ts`, `research/schema.ts`, and `research/prompt-section.ts`. `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` passed 8/8. | Constrained `source_urls` to exactly one URL and updated the tool description to call `frontend_research` separately for additional pages. |
| AGENT-004 | high | fixed, tested | Deep research and frontend research evidence refs merged as bare IDs, so duplicate `ev_1` IDs across briefs became ambiguous but still validated. | Independent lane C traced `research/prompt-section.ts`, `requirements/agent.ts`, `requirements/output-tools.ts`, and `research/schema.ts`. Focused requirements, research persistence, architect output-tools tests, and `packages/opencorvus` typecheck passed. | Downstream research evidence refs are now source-qualified as `deep_research:<id>` or `frontend_research:<id>`. Requirements and Architect validation reject bare ambiguous refs. |
| ORCH-001 | high | fixed, tested | `restart_from_stage("executor")` exposes deleted scheduler/tool action names such as `submit_execution` / `create_run` as continuation facts. | Independent lane C traced `orchestrator/scheduler.ts`, `orchestrator/tools.ts`, `agent/agent.ts`, and `test/orchestrator/scheduler.test.ts`. `bun test packages/opencorvus/test/orchestrator/scheduler.test.ts` passed 7/7. | Changed executor restart continuation facts to current tool semantics (`build` with active plan, `architect` without active plan) and removed fake `nextAction(runID)` formatting. |
| GOAL-001 | high | fixed, tested | Goal build background finalization errors can be swallowed, leaving a permanent live `goal_run` that blocks retry and terminal refill. | Independent lane A traced goal build async finalization in `orchestrator/tools.ts`, persistence in `engine/persist.ts`, runtime refill in `engine/runtime.ts`, and live-run dedupe. Targeted tests `goal build returns started after binding goal_run and finalizes in the background` and `goal build background finalize failure does not leave a live goal_run` both passed. | If `finalizeBuildAttempt` throws while the goal_run is still live, the build tool now marks that goal_run failed and records the finalization error instead of leaving it running. |
| GOAL-002 | high | fixed, tested | `modify_goal` refused live build tool ownership but did not refuse a durable live `goal_run` when no ownership artifact remained. An async build can return `started` after opening a live `goal_run`; mutating the goal contract before that attempt reaches terminal status invalidates the child session's contract mid-run. | Independent lane A traced async build ownership closure in `packages/opencorvus/src/orchestrator/tools.ts`, live `goal_run` persistence in `packages/opencorvus/src/engine/persist.ts`, and the missing durable live-run check in `modify_goal`. Regression added in `tools.test.ts` seeds a running `goal_run` without live ownership and requires `modify_goal` to leave the goal unchanged. `tools.test.ts -t "contract mutation"` 2/2 and `packages/opencorvus` typecheck passed. | `modify_goal` now checks the same durable live `goal_run` source used by build duplicate-dispatch protection before applying contract updates. |
| REVIEW-003 | low | human review | Queued task path may report `started` even when `advanceQueue(cwd)` cannot start due to an active owner. | Independent lane A traced `engine/queue.ts`; production impact depends on terminal refill path. | Review after current high-confidence fixes. |
| REVIEW-004 | low | human review | `findActiveRunForTask` name implies active but implementation returns newest run. | Independent lane A traced `engine/store.ts`; key runtime callers have ID guard. | Rename/contract cleanup only after call-site audit. |
| REVIEW-005 | low | human review | Terminal goal refill wake fact insertion is not obviously atomic across public concurrent `syncRun` / `syncTask` calls. | Independent lane A traced `engine/runtime.ts`; production concurrency not confirmed. | Needs concurrency model confirmation. |
| REVIEW-006 | low | human review | Integrity direct evidence tools do not include a dedicated `frontend_research` section. | Independent lane C traced integrity team/acceptance tools; visual QA already consumes frontend research. | Product/reviewer responsibility clarification needed. |
| REVIEW-007 | low | human review | `frontend-design` static/session tool lists differ. | Independent lane C traced runtime injection and static list; difference may be intentional. | No code change without contract decision. |
| REVIEW-008 | low | human review | `continuationToolName` contains names not matching all current orchestrator tool names. | Independent lane C noted current active call sites only cover existing fixed agents. | Revisit during broad finalizer recovery repair. |
| TEST-001 | high | fixed, tested | Several older `tools.test.ts` goal-build tests seeded tasks under synthetic project ids while running inside `Instance.provide()`, so filtered runs such as `bun test --timeout 15000 packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build"` failed with `Task not found in current project` before reaching the behavior under test. | During GOAL-001 verification, the wider name-filtered subset exposed stale fixtures that passed `projectID` to `insertWorkflowTaskWithGoal()` instead of the current `Instance.project.id`; retry attachment assertions also expected the old synthetic attachment URL prefix after the attachment was correctly written under the current project. The focused filtered run now passes 18/18. | Updated only affected test fixtures to bind their task/attachments to `Instance.project.id` and avoid duplicate project insertion. Production `taskPrimaryProjectRoot` remains strict. |
| AGENT-005A | high | fixed, tested | `fact_check` is a terminal-tool agent but did not expose same-session recovery when it ended without `report_fact_check_result`. A naive retry would start a fresh verifier session, while a naive continuation could retarget the latest assistant message instead of the failed attempt's original snapshot. | Sartre independently audited the `fact_check` wrapper and confirmed `StageContinuationStage` already includes `fact-check`, `continuationToolName()` maps it to `fact_check`, and `FactCheckAgent.run()` already has terminal tool `report_fact_check_result`. Regression `[I] terminal finalizer miss persists tool_error before same-session continuation` verifies first-call `tool_error` persistence, stage-continuation artifact scope, second-call continuation, and final completed-cache behavior. `orchestrator-tool-descriptions.test.ts`, `fact-check/orchestrator-tool.test.ts`, `packages/opencorvus` typecheck, and `git diff --check` passed. | Added exact fresh-vs-continuation schema, persisted the original snapshot in `normalized_stage_input`, made continuation-only calls use that snapshot as the single source of target data, passed `AgentSessionContinuation` into `FactCheckAgent.run`, and preserved the existing synthetic `tool_error` artifact before returning the continuation pointer. |
| AGENT-005B | high | fixed, tested | `integrity` is a terminal-tool agent but did not expose same-session recovery when it ended without `submit_integrity_consensus`. A schema-only fix would have been wrong because integrity also owns task-level orchestrator tool ownership while the child session runs. | Wegener independently audited `integrity` and confirmed `StageContinuationStage` includes `integrity`, but the `integrity` tool only exposed `reason`, `reviewIntegrity` did not accept `continuation`, and ownership/session lifecycle must be reopened for continuation because `runAgentSession` does not call `onSessionCreated` when resuming an existing session. Regression `integrity terminal finalizer miss returns same-session continuation with ownership closed` verifies continuation artifact scope, no missing-finalizer `integrity_attempt`, one final artifact after continuation, and no live ownership leaks. `team-agent.test.ts`, orchestrator schema tests, the targeted orchestrator wrapper test, `packages/opencorvus` typecheck, and `git diff --check` passed. | Added `continuation_artifact_id`, passed `AgentSessionContinuation` through `reviewIntegrity`, reopened ownership for resumed sessions, closed ownership on both finalizer-miss and completed continuation paths, and persisted `active_spec_snapshot_id` / phase / goal ids in `normalized_stage_input` with a hard scope check before resuming. |
| AGENT-008 | high | fixed, tested | `fact_check` emitted `workflow.step.updated` running for workflows containing a `tool: "fact_check"` step, but none of its return paths emitted completed or failed. Custom workflow board replay could therefore leave the fact-check step visually running after cached, rejected, continuation, tool-error, or successful exits because `taskStepStatusByTool()` has no persistent `fact_check` projection. | Independent lane B traced `trackStepStart("fact_check")` in `packages/opencorvus/src/orchestrator/tools.ts`, the missing `trackStepComplete("fact_check")`, and `findStepByTool()` custom workflow binding. `fact-check/orchestrator-tool.test.ts` now verifies live workflow events for normal completed, cached completed, target-streaming rejection failed, and terminal-finalizer-miss continuation failed. Full fact-check orchestrator tool test 10/10 and `packages/opencorvus` typecheck passed. | Wrapped the fact-check tool body in a scoped `try/finally` that emits `trackStepComplete("fact_check", failed)` on every exit. The step defaults to failed; cached and completed agent outcomes set it to completed before returning. |
| AGENT-009 | high | fixed, tested | `renderFrontendDesignHandoffReference()` returned a non-empty "Frontend Design Public Report" path block before checking whether any canonical `frontend_design` decision-log handoff entry existed. Downstream agents treated that non-empty string as real task-specific frontend_design context, producing phantom handoffs and misleading build overlays from path shells. | Independent lane C traced `packages/opencorvus/src/frontend-design/handoff.ts`, orchestrator/build consumers that use non-empty handoff text as a context signal, and `packages/opencorvus/src/build/prompt-context.ts` overlay activation. Regressions verify no decision-log handoff entries produce an empty string, while real `public_report` entries still produce relative/absolute paths. `frontend-design/handoff.test.ts`, `pipeline/decision-log-bundle.test.ts`, `build-agent/prompt-context.test.ts`, `orchestrator/build-goal-reference.test.ts`, and `packages/opencorvus` typecheck passed. | Moved decision-log handoff-key lookup ahead of path rendering. The renderer now returns `""` until the canonical `frontend_design` phase contains at least one handoff key; path rendering and absolute-path validation only happen after real handoff evidence exists. |
| AGENT-010 | high | fixed, tested | `submit_workload_analysis` finalized a workload report when only one goal had a brief, even though the Goal Workload Analyst prompt and tool purpose require one `register_workload_brief` per architect goal. The PASS response merely noted uncovered goals, so downstream build prompts could receive partial sizing guidance without a terminal error. | Independent lane C traced the prompt requirement in `packages/opencorvus/src/goal-workload-analyst/prompt.ts`, the partial validator in `packages/opencorvus/src/goal-workload-analyst/output-tools.ts`, and build-time per-goal injection in `packages/opencorvus/src/orchestrator/tools.ts`. Regression added in `goal-workload-analyst/output-tools.test.ts` blocks a two-goal submission with only `gol_a` and requires `gol_b` before PASS. `goal-workload-analyst/output-tools.test.ts` 6/6 and `packages/opencorvus` typecheck passed. | `validate()` now compares collector briefs against the full known-goal set, `isReadyToFinalize()` shares the same predicate, and PASS no longer contains a "without a brief" note because missing briefs are terminal blockers. |
| AGENT-011 | high | fixed, tested | `deep_research` accepted fresh `source_urls` together with `continuation_artifact_id`, persisted both in the normalized stage input, then resumed the existing child session with `sourceUrls: undefined`. Fresh URLs were therefore silently dropped in continuation mode. | Independent lane C traced the input schema and execution in `packages/opencorvus/src/orchestrator/tools.ts`: schema exposed both fields without mutual exclusion, while the runner explicitly ignores `source_urls` when `continuation` is present. Regression added in `orchestrator-tool-descriptions.test.ts` rejects `continuation_artifact_id` plus non-empty `source_urls`. `orchestrator-tool-descriptions.test.ts` 8/8 and `packages/opencorvus` typecheck passed. | Added a single `DeepResearchInputSchema` with a schema-level data-integrity rejection for continuation plus fresh source URLs; the tool now uses that schema as its only input contract. |
| AGENT-012 | high | fixed, tested | The `AGENT-009` phantom frontend-design handoff fix still treated `reference_artifacts` alone as enough to render a "Frontend Design Public Report" path block. That path block activates build prompt context as if a public report exists, even though `reference_artifacts` is a Visual QA/reference-parity input and may exist without a finalized public report. | Independent lane C traced `FRONTEND_DESIGN_HANDOFF_KEYS` including `reference_artifacts`, `renderFrontendDesignHandoffReference()` rendering public-report paths for any handoff key, and build prompt context treating non-empty handoff text as `frontend-design-handoff` / `visual-reference` context. Regression added in `frontend-design/handoff.test.ts` seeds only `reference_artifacts` and requires an empty renderer result. The frontend-design handoff, decision-log bundle, build prompt context, build goal reference suites 40/40 and `packages/opencorvus` typecheck passed. | `renderFrontendDesignHandoffReference()` now requires a canonical `public_report` entry before rendering public-report paths. `reference_artifacts` remains available through Visual QA's dedicated frontend-design context. |
| AGENT-013 | high | fixed, tested | `visual_qa` and `deep_research` accepted fresh prompt-only scope fields together with `continuation_artifact_id`, but continuation mode resumes an existing child session and skips the normal fresh prompt path. Those fresh fields were therefore silently discarded while the tool call looked accepted. | Independent lane B traced `VisualQaInputSchema`, `DeepResearchInputSchema`, the visual QA and deep research wrappers in `packages/opencorvus/src/orchestrator/tools.ts`, and `runAgentSession` continuation behavior in `packages/opencorvus/src/agent/runner.ts`. Regression assertions were added to `orchestrator-tool-descriptions.test.ts` for `visual_qa` continuation plus `focus` / `app_url` / `preview_command`, and `deep_research` continuation plus `target_deliverable` / `source_urls` / `focus`. `orchestrator-tool-descriptions.test.ts` 8/8 and `packages/opencorvus` typecheck passed. | Schema validation now treats continuation as an exclusive same-session recovery mode for those tools and rejects mixed fresh scope fields. |
| AGENT-014 | high | fixed, tested | The `frontend_research` tool contract now requires one source URL per call, but downstream prompt consumers only read `findLatestFrontendResearchBriefArtifact()`. Multiple single-page calls therefore hid all but the newest page. A naive concatenation would also reintroduce ambiguous `frontend_research:ev_1` refs across page-local evidence ids. | Independent lane C traced `tools.ts` source URL contract, `engine/store.ts` latest-only frontend brief lookup, `research/prompt-section.ts` prompt injection, read_context projection, and Visual QA frontend research context. Regressions cover two active frontend research briefs with the same local `ev_1` id and assert Requirements, Architect, Build, Visual QA, and read_context include both pages. `research/persist-describe.test.ts`, `visual-qa/context.test.ts`, Requirements/Architect evidence-ref tests 64/64 combined, `tools.test.ts -t "read_context surfaces multiple frontend research briefs"` 1/1, and `packages/opencorvus` typecheck passed. | Added a list API for validated frontend research brief artifacts, changed downstream prompt renderers to aggregate non-stale briefs with a deterministic cap, changed read_context to summarize multiple frontend briefs, fixed its stale-check import path, and scoped frontend research evidence refs as `frontend_research:<artifact_id>:<local_evidence_id>`. |
| AGENT-015 | high | fixed, tested | Generic same-session stage continuation stored `normalized_stage_input` / `input_digest` but most tool wrappers did not compare the stored digest with the current durable task/spec/goal scope before resuming. A stale continuation artifact could therefore append to an old child session after the active spec or goal graph changed. | Independent lane B traced `stage-continuation.ts` storage, `continuationFromArtifact()` in `orchestrator/tools.ts`, and architect / workload / visual QA wrappers that previously passed only stage + finalizer. Regressions mutate the active requirements spec or workload goal graph after a terminal finalizer miss and require the continuation call to fail before the mocked agent is invoked. `tools.test.ts -t "continuation"` passed 8/8, `orchestrator-tool-descriptions.test.ts` 8/8, `fact-check/orchestrator-tool.test.ts -t "terminal finalizer miss"` 1/1, and `packages/opencorvus` typecheck passed. | Added stable task/spec/goal scope fingerprints, made `continuationFromArtifact()` optionally compare the expected digest, removed `continuation_artifact_id` from generic normalized stage scope, and kept pointer human-readable reasons separate from scope digests. |
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
- Applied `AGENT-009` for phantom frontend_design handoff context. The handoff
  renderer now reads canonical `frontend_design` decision-log keys before
  rendering path blocks and returns an empty string when no handoff exists.
  Verified empty-handoff, relative path, absolute path, build prompt context,
  and goal build context tests plus `packages/opencorvus` typecheck.
- Applied `AGENT-010` for partial workload-analysis finalization. The terminal
  validator now requires a brief for every known architect goal before PASS.
  Verified with full `goal-workload-analyst/output-tools.test.ts` and
  `packages/opencorvus` typecheck.
- Applied `AGENT-011` for deep-research continuation input ambiguity.
  `deep_research` now rejects `continuation_artifact_id` plus fresh
  `source_urls`, matching the runner behavior that resumes the existing child
  session rather than fetching fresh URLs. Verified with orchestrator tool
  schema tests and `packages/opencorvus` typecheck.
- Applied `AGENT-012` after second-round lane C audit found that
  `reference_artifacts` alone still triggered frontend-design public-report
  path projection. The renderer now requires `public_report` before emitting
  those paths. Verified with frontend-design handoff, decision-log bundle,
  build prompt context, build goal reference suites, and package typecheck.
- Applied `AGENT-013` for mixed continuation/fresh-scope inputs on
  `visual_qa` and `deep_research`. Both tools now reject fresh prompt-only
  scope fields when `continuation_artifact_id` is present, matching the
  runner behavior that resumes the existing child session instead of building
  a new prompt.
- Applied `SCHED-003` for terminal goal refill wake coalescing. Runtime sync
  now records all newly observed terminal goal refill facts after one
  successful `dispatchTaskLoop` result, instead of starting one orchestrator
  pass per terminal goal run in the same observation.
- Applied `SCHED-004` for stale no-live-goal liveness documentation/tests.
  The passive restart regression now asserts the selected terminal-goal refill
  observer contract and explicitly rejects the retired `noLiveGoalWakeFingerprint`
  / `syncNoLiveGoalRuns` path. `task-api` comments now describe the runtime
  observer as interaction-blocker + terminal-refill projection, not no-live
  batch settlement.
- Applied `GOAL-002` for live `goal_run` contract protection. `modify_goal`
  now rejects durable live goal attempts even when the build tool ownership
  artifact has already closed, preventing async child sessions from running
  against a contract that changed mid-attempt.
- Applied `AGENT-014` for multi-page frontend_research consumption. Downstream
  Requirements, Architect, Build, and Visual QA contexts now consume all
  non-stale frontend research briefs up to a compact cap, and frontend
  evidence refs include the artifact id so page-local evidence ids cannot
  collide.
- Applied `AGENT-015` for stale same-session stage continuation scope.
  Continuation artifacts now compare stored scope digests against current
  durable task/spec/goal fingerprints before resuming generic stage agents.
  Architect and workload-analysis regressions mutate the active spec or goal
  graph after a finalizer miss and assert the stale continuation is rejected
  before the child agent mock is invoked. Scope fingerprints intentionally
  exclude `continuation_artifact_id`; pointer reasons remain separate so
  recovery instructions stay readable without becoming part of identity.
- Applied `TEST-001` for stale goal-build fixtures that no longer matched the
  current project-scoped task lookup contract. The filtered `goal build`
  benchmark now passes 18/18 without relaxing production project isolation.
