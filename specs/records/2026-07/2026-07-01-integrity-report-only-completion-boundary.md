# Integrity Report-Only Completion Boundary

## Recall

User request:

- First organize and repair bugs that are unrelated to Integrity.
- Then systemically review the Integrity problem.
- Current Integrity acceptance has a major bug: final task completion must not be hijacked by Integrity.
- The scheduler/orchestrator decides when a task is complete.
- Integrity may only output an accept or reject report.

Acceptance criteria:

- Non-Integrity bug classes from the investigated failures are listed separately from the Integrity boundary fix.
- `complete_task` is an Orchestrator lifecycle decision, not a host check for a latest post-build pass `integrity_attempt_id`.
- Integrity still records a structured report with verdict and findings, but its verdict is advisory evidence for the Orchestrator's next decision.
- Prompts, workflow hints, architecture docs, and tests no longer describe Integrity as the task terminal authority.
- No fallback, no hidden gate, no state-machine workaround, no git reset, no process restart, and no broad unrelated cleanup.

Hard constraints:

- The worktree is already dirty; existing changes must be preserved and not reverted.
- All implementation must stay in the current worktree.
- Any code change must have targeted tests.
- Specs remain under `specs/records/2026-07/` and must be indexed from the July README.

Sources read:

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-06/2026-06-25-visual-evidence-no-hard-gate-root-repair.md`
- `specs/records/2026-06/2026-06-25-visual-qa-self-report-consistency-repair.md`
- `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/opencorvus/src/engine/workflow.ts`
- `packages/opencorvus/src/integrity/team-agent.ts`
- `packages/opencorvus/src/prompt/core/integrity-team-core.txt`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
- `packages/opencorvus/test/agent/integrity-prompt-repository-baseline.test.ts`

Whole-repository search evidence:

- `rg -n "integrity|Integrity|VisualEvidenceBundle|complete_task|fail_task|needs_correction|effective_accepted|report_build_result|task\\.failed" .`
- `rg -n "complete_task|integrity_attempt_id|post-build integrity|Integrity|integrity_attempt|pass result" packages/opencorvus/src/prompt/core/orchestrator-core.txt packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/agent/integrity-prompt-repository-baseline.test.ts packages/opencorvus/test/orchestrator/tools.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts`
- `rg -n "complete_task: tool|fail_task: tool|integrity: tool|visual_qa: tool|findLatestIntegrityAttemptArtifact|integrityAttemptVerdict|integrity_attempt_id" packages/opencorvus/src/orchestrator/tools.ts`
- `rg -n "submit_integrity_consensus|summarizeIntegrityConsensusVisualEvidenceAdvisories|visualEvidenceRequired|RECORDED: integrity" packages/opencorvus/src/integrity/team-agent.ts packages/opencorvus/src/prompt/core/integrity-team-core.txt packages/opencorvus/test/integrity -g "*.ts"`
- `rg -n "@playwright/test|playwright" package.json packages/opencorvus/package.json packages/overlay/package.json packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.json"`
- `rg -n "Database\\.effect|effect idle|drainEffects|hasActiveContext|resetDatabase|removeDatabaseFile|db-effect" packages/opencorvus/test packages/opencorvus/src/storage packages/opencorvus/src -g "*.ts"`

Independent agent feedback:

- ETFs remote task: not final build failure; repeated Integrity rounds blocked on visual/interaction evidence and missing scoped `VisualEvidenceBundle`; final abort followed `task.failed`.
- Corporate Bonds remote task: all goals passed and build completed; final blocker was engine-scoped `VisualEvidenceBundle` not available and Visual QA machine fields remained rejected; final abort followed `task.failed`.
- Stock Screener remote task: all goals passed and build completed; three post-build Integrity attempts remained `needs_correction`; scoped visual evidence and effective Visual QA stayed rejected; final abort followed `task.failed`.

## Non-Integrity Bug Triage

The investigated failures exposed non-Integrity bugs or repair lanes that must stay separate from the Integrity boundary change:

| Bug class | Evidence | Disposition |
| --- | --- | --- |
| Runtime dependency/toolchain failure | ETFs R2 hit `ERR_MODULE_NOT_FOUND: Cannot find package '@playwright/test'`. | Same-task build repair fixed that remote page; this repository already carries Playwright runtime sidecar plumbing and dependencies, so no new fallback dependency path is introduced here. |
| Build lifecycle cleanup failure | Existing dirty changes keep a completed build run completed when post-delivery worktree cleanup is refused, and record a diagnostic decision-log entry instead. | Preserve and test existing repair; do not let cleanup diagnostics rewrite delivered build status. |
| Missing root ownership used as stale-child evidence | Existing dirty changes remove `recover_stale` and make `cancel_subagent` refuse cancellation when only root build ownership is missing. | Preserve and test existing repair; root tool ownership is dispatch lifecycle, not child build liveness evidence. |
| Operator message blocked behind live root ownership | Existing dirty changes start an operator-message root wake even while live ownership remains active, without cancelling the child. | Preserve and test existing repair; operator steering must be visible to the scheduler without killing active workers. |
| Test database WAL lock after lifecycle tests | Full `tools.test.ts` exposed `opencorvus.db-wal` deletion timeouts. `Database.effect` launches async post-commit effects without exposing an idle boundary, so test reset can close/delete the database while an effect is still publishing events or reading storage. | Add first-class effect idle tracking and make `resetDatabase()` wait for true post-commit effect quiescence before deleting WAL files. This is a test/tooling close-boundary fix, not an Integrity fallback. |
| Retry feedback same-key ordering was nondeterministic | Full `tools.test.ts` showed `goal build retry reuses the prior build session by default` flip between a newer clarified `build_retry_previous_*` entry and the older/generic goal-run error. `DecisionLog.readByKey` only ordered by `time_created`, and several entries can be appended in the same millisecond. | Order decision-log reads by `(time_created, id)` and make retry feedback preservation recognize both raw `Terminal error:` entries and clarified `Previous goal_run ... terminal error` entries, so precise retry evidence is not overwritten by generic text. |
| Invalid lifecycle test IDs polluted post-commit effects | `start-new-attempt.test.ts` used `task_sna_*` and `goal_sna_*` fixture IDs, while post-commit status effects validate `tsk*` and `gol*` identifiers. The test still passed but emitted schema warnings from the real effect path. | Change the fixture IDs to `tsk_sna_*` and `gol_sna_*`, then rerun the lifecycle tests to prove the warnings disappear. |

## Integrity Boundary Decision

Integrity is a review/report producer. It may return `pass`, `concerns`, or `needs_correction` with findings, evidence, required repairs, and unresolved disagreements. The Orchestrator may use that report as strong evidence, but the host tool must not require a latest post-build `pass` artifact before allowing task completion.

`complete_task` becomes a terminal Orchestrator lifecycle tool:

- Input: a required completion `summary`.
- It refuses only already terminal tasks and missing/empty summary.
- It writes terminal task completion from the Orchestrator decision.
- It may mention current Integrity evidence in the summary, but it does not validate `integrity_attempt_id`, verdict, phase, freshness, or existence.

`integrity` remains useful and visible:

- It records the report artifact and event.
- Non-pass output is repair evidence, not a scheduler stop signal.
- Pass output is acceptance evidence, not the completion authority.

## Implementation Plan

1. Replace `CompleteTaskInputSchema` so `integrity_attempt_id` is removed and `summary` is required.
2. Simplify `complete_task` execution to terminalize from the Orchestrator summary, without reading or validating Integrity attempts.
3. Reword `integrity` tool descriptions, `renderIntegrityOutcome`, workflow hints, current architecture docs, and orchestrator prompt text to say report/evidence rather than terminal authority.
4. Update prompt and tool tests so they assert report-only Integrity and Orchestrator-owned completion.
5. Run targeted tests for orchestrator tools, prompt hygiene, integrity prompt baseline, and the non-Integrity dirty repairs touched by this task.

## Validation

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/storage/db-effect.test.ts packages/opencorvus/test/pipeline/decision-log.test.ts packages/opencorvus/test/engine/start-new-attempt.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/start-new-attempt.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts packages/opencorvus/test/orchestrator/deliver-terminal-workflow.test.ts packages/opencorvus/test/agent/integrity-prompt-repository-baseline.test.ts packages/opencorvus/test/engine/workflow-integrity-step.test.ts packages/opencorvus/test/orchestrator/orchestrator-tool-descriptions.test.ts packages/opencorvus/test/visual-qa/agent.test.ts packages/opencorvus/test/visual-qa/strict-reference-fidelity.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `rg -n 'blockActiveRunForTask|integrityAttemptVerdict' packages/opencorvus/src/orchestrator/tools.ts` returned no matches.
- `git diff --check`
