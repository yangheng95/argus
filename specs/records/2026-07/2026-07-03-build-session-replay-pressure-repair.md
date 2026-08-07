# Build Session Replay Pressure Repair

Date: 2026-07-03
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | After the TradingView World Economy clone task accumulated extremely large Build contexts, identify when the problem was introduced and implement a systemic fix. The user explicitly rejected task/evidence gates and wants Build to remain a generic agent. |
| Acceptance criteria | Build retry must not keep replaying oversized old transcripts; no task-specific evidence gate; retry must reuse the recorded goal worktree when opening a fresh Build session; terminal finalizer recovery must not append another turn to an already overweight Build transcript; tests must prove small retry still resumes, large retry opens a fresh session on the same worktree, and the decision is based on generic replay pressure facts. |
| Hard constraints | No fallback/compatibility path; no host state-machine gate for frontend evidence; no blind patch; no git reset; no new worktree; do not restart or interfere with OpenCorvus/overlay processes; specs live under root `specs/`; code changes require focused tests and final push to `myhexin`. |
| Sources read | `specs/current/architecture/02-data.md`; `specs/current/architecture/09-verification-evidence.md`; `specs/current/architecture/10-worktree-lifecycle.md`; `specs/current/architecture/18-webpage-replica-agent-workflow.md`; `specs/records/2026-06/2026-06-25-context-recovery-and-worktree-reuse.md`; `specs/records/2026-06/2026-06-25-build-retry-session-resume-and-visible-feedback.md`; `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`; `specs/records/2026-07/2026-07-03-generic-build-evidence-gate-removal.md`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/build/agent.ts`; `packages/opencorvus/src/agent/runner.ts`; `packages/opencorvus/src/session/message.ts`; `packages/opencorvus/src/session/loop.ts`; `packages/opencorvus/src/session/context-budget.ts`; `packages/opencorvus/src/provider/hexin-profiles.ts`; `packages/opencorvus/src/config/config.ts`. |
| Whole-repository grep | `rg -n "selectGoalBuildRetrySession\|existingSessionID\|createBuildTerminalContinuationRequest\|runOpenCorvusBuildSession\|toModelMessages\\(\|toolOutputMaxChars\|ContextBudget\|STATEFUL_SNAPSHOT_TOOLS\|build_session_contract\|inputEvidenceManifest" packages/opencorvus/src packages/opencorvus/test specs/current specs/records`; `rg -n "Message\\.stream\\(\|PartTable\|MessageTable\|SessionControl" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`; `rg -n "compaction\\?\|preserve_recent_tokens\|threshold\|reserved\|agent.*build" packages/opencorvus/src/config packages/opencorvus/test/config packages/opencorvus/test/session -g "*.ts"`. |
| Runtime evidence | Task `tsk_f27349e1f001Bas0d2mDBv13yN`, NewsFeed Build session `ses_0d8847737ffeK1e1cBzKUvfppk`: 2026-07-03 18:27:43 CST had `221,397` input tokens; 18:40:41 terminal miss had `253,093` input tokens; 21:01:58 retry reached `372,924` input tokens. Four affected Build sessions had 1.3MB-1.7MB persisted part data and zero compaction parts. |
| Commit evidence | `ea60ac8f22` (2026-06-25 13:37 CST) made Build retries keep existing sessions and removed model/operator `freshContext`. `d4e4d00c11` and `a0f5add956` later handled missing/context-error/compaction-blocked sessions, but not valid yet overweight transcripts. `d1a959762d` and `a15096a142` on 2026-07-03 increased visual/evidence replay pressure. `82d7a25117` removed the generic evidence gate after the runtime session had already reached 253k tokens, so it exposed the issue but did not introduce it. |
| Independent agent feedback | No new sub-agent delegation in this implementation turn. Earlier user-requested impact investigation had already identified the same-session retry and visual evidence amplification as the shared failure surface. |

## Root Cause

The 2026-06-25 recovery contract correctly made the worktree the durable
implementation state, but it treated every structurally valid prior Build
session as resumable. That missed a second non-resumable condition: a transcript
can be valid but too expensive to replay. Because `Message.toModelMessages`
replays ordinary Build `read`, `bash`, `apply_patch`, and browser tool outputs
verbatim unless compaction has already rewritten them, a long failed Build
session can grow to hundreds of thousands of input tokens without hitting the
model's 1M-token context threshold.

The problem is therefore not the TradingView task, not a source-row name, and
not a missing evidence field. It is the mismatch between Build retry lifecycle
and provider replay pressure.

## Repair Plan

1. Add a generic Build session replay-pressure reader over `message` / `part`
   rows. It records latest assistant input tokens, message/part bytes, tool
   output bytes, tool input bytes, and un-compacted tool count. It does not
   inspect task title, evidence role, filename, URL, or frontend-specific names.
2. Define a Build retry replay budget from the resolved Build model and config.
   The budget is a lifecycle threshold for whether the old transcript is
   reusable; it is not a dispatch evidence gate.
3. Extend `selectGoalBuildRetrySession` so a structurally valid but overweight
   prior session returns `contextUnavailableReason` and no `existingSessionID`.
   The existing fresh-session-on-same-worktree path then creates a clean Build
   session while preserving the recorded worktree.
4. Update Build terminal finalizer recovery. If the current Build transcript is
   already overweight after a missing finalizer, do not run same-session
   continuation. Surface a failed Build result with a concrete error so the next
   orchestrator retry opens a fresh Build session on the same worktree.
5. Keep `build_session_contract.input_evidence` as the durable input owner when
   present. Fresh retry creates a new Build session and contract; same-session
   retry still uses the original manifest for persisted staged-file repair.
6. Add regression tests for the pressure calculation and orchestrator retry
   selection. Existing tests that prove normal valid retry reuses the prior
   session must keep passing.

## Non-Goals

- Do not reintroduce a model-facing `freshContext` argument.
- Do not add frontend-replica, TradingView, source-row, or evidence-role
  special cases.
- Do not change generic attachment read behavior into a missing-file fallback.
- Do not make Visual QA or Integrity lifecycle authorities.

## Implementation

- Added `BuildSessionReplayPressure`, a generic reader over persisted
  `message` and `part` rows. It estimates replay pressure from latest
  assistant input tokens plus persisted text, reasoning, tool input, and tool
  output character counts.
- Added `agent.build.retry_replay_token_limit` as an optional explicit replay
  budget. Without it, the budget is derived from the resolved Build model's
  output window and existing `ContextBudget` constants.
- Updated goal Build retry selection so structurally valid but overweight
  previous sessions are treated as context-unavailable. The retry still uses
  the recorded managed worktree and records the concrete pressure reason in
  `decision_log`.
- Updated missing-terminal recovery so same-session finalizer continuation is
  skipped when the current transcript is already overweight. The resulting
  Build contract error tells the orchestrator to create the next retry as a
  fresh Build session on the recorded goal worktree.

## Validation

- `bun test packages/opencorvus/test/build-agent/session-replay-pressure.test.ts`
- `bun test packages/opencorvus/test/build-agent/contract-error.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build retry (reuses the prior build session by default|opens a fresh session on the same worktree when prior replay pressure is too high|opens a fresh session on the same worktree after prior context overflow)"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/config/config.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
