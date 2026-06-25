# Context Recovery And Worktree Reuse

Date: 2026-06-25

## Objective

Implement ordered recovery for agent sessions:

1. Prefer same-session continuation when the existing context is valid.
2. If the context is unavailable, start a fresh child session with no copied
   message history.
3. Reuse the goal worktree for every build retry; never switch worktrees merely
   because the transcript cannot be resumed.

This is not a fallback path. It is one explicit recovery contract whose sources
are durable artifacts, session rows, and goal-run workspace facts.

## Independent Audit

Four read-only agents reviewed the current state:

| Agent | Finding |
| --- | --- |
| Euclid | Compaction failure stops the current loop and does not fresh retry. Failed compaction summaries are not valid boundaries and do not trim history. |
| Laplace | Stage continuation exists for terminal tool misses but not terminal StructuredOutput misses; `analyze_intent` has no continuation input. |
| James | Build can already create a new session on an existing `managedWorktree`, but orchestrator retry selection throws when the prior `session_id` is absent or unusable. |
| Bacon | Provider schema errors are not retryable. StructuredOutput payload errors belong to same-turn tool error repair. Terminal `StructuredOutputError` needs protocol continuation, not generic retry. |

## Call Point Matrix

| Surface | Current behavior | Required behavior |
| --- | --- | --- |
| `agent/runner.ts::runAgentSession` | `continuation` appends a visible user message and loops the same session. A fresh call to `Session.createNext()` creates an empty transcript. | Keep as the single continuation/fresh-session primitive. |
| `orchestrator/tools.ts::continuationResultForTerminalFinalizerMiss` | Recognizes only `TerminalToolMissingError`. | Generalize to protocol finalizer miss and recognize terminal `StructuredOutputError` with `finalizerName="StructuredOutput"`. |
| `orchestrator/tools.ts::analyze_intent` | No `continuation_artifact_id`; catch always logs abort and rethrows. | Accept `continuation_artifact_id`, pass it to `IntentAnalysisAgent.analyze`, and create continuation artifacts on terminal StructuredOutput miss. |
| `intent-analysis/agent.ts` | Always starts a new intent-analysis session. | Accept `AgentSessionContinuation` and pass it to `runAgentSession`. |
| `orchestrator/tools.ts::build` retry session selection | Uses latest terminal `session_id` when present; missing session id throws. | Validate the prior session against kind, goal id, and recorded worktree. Use it when valid; otherwise omit `existingSessionID` while preserving `managedWorktree`. |
| `BuildAgent.run` with `managedWorktree` | Can create a new session on the supplied worktree when `existingSessionID` is omitted. | Reuse this existing primitive for fresh-context build retry. |
| `orchestrator/tools.ts::cleanupCompletedGoalWorkspace` and `engine/writer.ts::cleanupGoalWorkspaceForGoal` | Successful goal builds can remove the completed worktree and clear workspace pointers. | Do not auto-clean completed goal worktrees at build success. Explicit task terminal cleanup may remain separate. |
| `SessionCompaction.process` / `SessionPrompt.loop` | Failed compaction returns stop and does not create fresh sessions. Failed summaries are not valid compaction boundaries. | Keep failed summaries out of replay. Future work may expose a typed failed-context outcome, but fresh build retry must be driven by durable build/session facts, not by compactor-created sessions. |

## Recovery Semantics

- Same-session continuation is used for valid `stage_continuation_request`
  artifacts and resumable prior build sessions.
- Fresh context means a new session row and no copied messages from the failed
  session. Its prompt is rebuilt from task, goal, decision-log, retry feedback,
  and artifact facts.
- Worktree reuse means the fresh build session receives the same
  `managedWorktree.directory`, `managedWorktree.branch`, and
  `managedWorktree.baseRef` recorded for the goal.
- Provider 400/schema/tool-choice errors remain fail-fast contract errors.
- `StructuredOutputPayloadError` remains same-turn tool error feedback; it must
  not be converted into fresh retry.
- Terminal `StructuredOutputError` is a protocol finalizer miss for the
  synthetic finalizer `StructuredOutput`.

## Acceptance

- `analyze_intent` schema includes `continuation_artifact_id`.
- A terminal `StructuredOutputError` from intent analysis returns a visible
  continuation result with `failure=StructuredOutputError`, not an abort-only
  decision log entry.
- Build retry with a valid prior session still passes `existingSessionID`.
- Build retry with missing/unusable prior session and a valid recorded worktree
  passes no `existingSessionID`, creates a fresh build session, and keeps the
  same worktree directory.
- Successful goal builds leave the goal workspace pointer intact.
- Tests prove old failed compaction summaries are not used as replay boundaries.
