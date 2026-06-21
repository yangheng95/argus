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
| AGENT-001 | high | pending next fix | Multiple orchestrator tools have agents capable of session/finalizer recovery, but the tool contracts do not expose `continuation_artifact_id` or do not wire `onSessionCreated` and terminal-finalizer-miss recovery. | Independent lane B reviewed `orchestrator/tools.ts`, `agent/runner.ts`, `visual-qa/agent.ts`, `fact-check/index.ts`, `research/agent.ts`, and related tests. Reported gaps include `analyze_goal_workload`, `visual_qa`, `fact_check`, `deep_research`, and `analyze_intent`. | Too broad for the scheduler liveness commit. Split into a dedicated follow-up repair with per-tool tests. |
| AGENT-002 | high | fixed, tested | `frontend_design` accepts `continuation_artifact_id` together with fresh visual scope fields (`urls`, `figma_url`, `materials`) and then silently drops the fresh scope in continuation mode. | Independent lane B traced `FrontendDesignInputSchema` and continuation execution in `packages/opencorvus/src/orchestrator/tools.ts`; `frontend_research` already has an exactly-one guard for the comparable URL/continuation case. `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` passed 8/8. | Added schema rejection for continuation plus fresh visual scope fields and regression assertions in `orchestrator-tool-descriptions.test.ts`. |
| AGENT-003 | high | fixed, tested | `frontend_research.source_urls` advertised multiple URLs, but the evidence/output/prompt contract is single-page and only consumed the first URL. | Independent lane C traced `source_urls` through `orchestrator/tools.ts`, `research/agent.ts`, `webpage-prd-evidence.ts`, `webpage-evidence.ts`, `research/output-tools.ts`, `research/schema.ts`, and `research/prompt-section.ts`. `bun test packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts` passed 8/8. | Constrained `source_urls` to exactly one URL and updated the tool description to call `frontend_research` separately for additional pages. |
| AGENT-004 | high | pending next fix | Deep research and frontend research evidence refs merge as bare IDs, so duplicate `ev_1` IDs across briefs become ambiguous but still validate. | Independent lane C traced `research/prompt-section.ts`, `requirements/agent.ts`, `requirements/output-tools.ts`, and `research/schema.ts`. | Needs a scoped evidence-ref contract repair with tests across requirements output validation. |
| ORCH-001 | high | pending next fix | `restart_from_stage("executor")` exposes deleted scheduler/tool action names such as `submit_execution` / `create_run` as continuation facts. | Independent lane C traced `orchestrator/scheduler.ts`, `orchestrator/tools.ts`, `agent/agent.ts`, and `test/orchestrator/scheduler.test.ts`. | Needs scheduler/tool output contract cleanup and tests. |
| GOAL-001 | high | pending next fix | Goal build background finalization errors can be swallowed, leaving a permanent live `goal_run` that blocks retry and terminal refill. | Independent lane A traced goal build async finalization in `orchestrator/tools.ts`, persistence in `engine/persist.ts`, runtime refill in `engine/runtime.ts`, and live-run dedupe. | Needs dedicated goal build finalization failure repair and regression test. |
| REVIEW-003 | low | human review | Queued task path may report `started` even when `advanceQueue(cwd)` cannot start due to an active owner. | Independent lane A traced `engine/queue.ts`; production impact depends on terminal refill path. | Review after current high-confidence fixes. |
| REVIEW-004 | low | human review | `findActiveRunForTask` name implies active but implementation returns newest run. | Independent lane A traced `engine/store.ts`; key runtime callers have ID guard. | Rename/contract cleanup only after call-site audit. |
| REVIEW-005 | low | human review | Terminal goal refill wake fact insertion is not obviously atomic across public concurrent `syncRun` / `syncTask` calls. | Independent lane A traced `engine/runtime.ts`; production concurrency not confirmed. | Needs concurrency model confirmation. |
| REVIEW-006 | low | human review | Integrity direct evidence tools do not include a dedicated `frontend_research` section. | Independent lane C traced integrity team/acceptance tools; visual QA already consumes frontend research. | Product/reviewer responsibility clarification needed. |
| REVIEW-007 | low | human review | `frontend-design` static/session tool lists differ. | Independent lane C traced runtime injection and static list; difference may be intentional. | No code change without contract decision. |
| REVIEW-008 | low | human review | `continuationToolName` contains names not matching all current orchestrator tool names. | Independent lane C noted current active call sites only cover existing fixed agents. | Revisit during broad finalizer recovery repair. |
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
