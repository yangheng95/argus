# Same-Session Subagent Recovery

Date: 2026-06-11

## Problem

Some worker agents can finish a model turn without calling their required final
tool. Example:

`frontend-design` ended after `read_file` and the session loop stamped
`TerminalToolMissingError: Model did not call terminal tool submit_frontend_template
before the turn ended`.

The current failure path bubbles that error to the orchestrator. The
orchestrator can retry the stage, but most non-build stage tools do not have a
first-class way to resume the same child session with the same runtime tool
contract. This creates an unnecessary split:

- `build` can continue a prior session through `existingSessionID`.
- requirements, architect, frontend-design, research, workload analysis, and
  visual-qa mostly restart by calling the stage tool again.

The root issue is not "missing one retry". The root issue is that same-session
continuation is implemented as a build-shaped feature even though
`runAgentSession` already owns the generic primitive.

## Current Evidence

Full-repo grep covered:

- `runAgentSession(` call sites in worker agents and orchestrator tools.
- `existingSessionID` call sites.
- `SessionRuntimeContract` installation and continuation validation.
- direct child-session reply / steering paths.
- terminal output error types.

Important facts:

- `runAgentSession` already accepts `existingSessionID` and validates kind,
  goal, and directory before prompting.
- `runAgentSession` installs a `SessionRuntimeContract` containing runtime
  tools, terminal tool contract, structured-output guard, stream hooks, and a
  `WorkerTurnDescriptor`.
- `appendDirectAgentSessionReply` can append a visible user message and wake a
  worker session, but it only works while the in-memory runtime contract still
  exists.
- generic direct reply explicitly rejects build sessions because build retry
  must reinstall a fresh stage runtime contract through `BuildAgent.run`.
- `build` passes `existingSessionID` from the latest terminal `goal_run` and
  keeps worktree / goal_run / merge evidence around the same child session.

## Call Point Matrix

| Area | Entry | Current session behavior | Target behavior |
| --- | --- | --- | --- |
| requirements | `packages/opencorvus/src/orchestrator/tools.ts` -> `RequirementsAgent.run` -> `runAgentSession` | Captures child session id but no same-session retry input | Continue the same requirements session when the same stage is re-dispatched for a protocol-level terminal miss |
| architect | `packages/opencorvus/src/orchestrator/tools.ts` -> `ArchitectAgent.coordinate` -> `runAgentSession` | Captures child session id but no same-session retry input | Continue the same architect session for protocol-level terminal miss; normal re-architecture after changed inputs remains a new/intentional stage run |
| frontend-design | `packages/opencorvus/src/orchestrator/tools.ts` -> `FrontendDesignAgent.analyze` -> `runAgentSession` | Captures child session id; terminal miss becomes orchestrator-visible failure | Continue the same frontend-design session and ask it to call `submit_frontend_template` |
| goal-workload-analyst | `GoalWorkloadAnalystAgent.analyze` -> `runAgentSession` | No same-session retry input | Continue same analyst session for `submit_workload_analysis` miss |
| frontend-research | `FrontendResearchAgent.run` -> `runResearchSession` -> `runAgentSession(existingSessionID: session.id)` | Creates/reuses a session internally for the first run only | Expose the same continuation contract to the orchestrator-level stage retry path |
| deep-research | `DeepResearchAgent.run` -> `runResearchSession` -> `runAgentSession(existingSessionID: session.id)` | Same as frontend-research | Same as frontend-research |
| visual-qa | `VisualQaAgent.analyze` -> `runAgentSession` | Agent supports `onSessionCreated`, but orchestrator currently does not pass it, so catch code cannot identify the failed child session | Pass `onSessionCreated`, persist a pending continuation on protocol miss, then continue the same visual-qa session for `submit_visual_qa_report` miss |
| intent-analysis | `IntentAnalysisAgent.analyze` -> `runAgentSession(format: json_schema)` | StructuredOutput miss becomes a runner error; no continuation input | Continue the same intent-analysis session for `StructuredOutput` miss when invoked through an orchestrated flow |
| fact-check | `FactCheckAgent.run` -> `runAgentSession` | Uses `report_fact_check_result` terminal tool and supports `onSessionCreated`, but the orchestrator fact_check tool currently does not pass it and records `(no-session:tool_error)` on throw | Pass `onSessionCreated` from the fact_check tool, persist a pending continuation on protocol miss, then continue the same fact-check session when the fact-check caller chooses retry |
| build | `BuildAgent.run` -> `runAgentSession(existingSessionID: buildSession.id)` | Already has same-session continuation plus worktree/goal_run state | Keep build-specific state; extract only the generic continuation shape |
| integrity | `reviewIntegrity` / team-agent -> `runAgentSession` | Uses `submit_integrity_consensus` terminal tool and already has `onSessionCreated`; review stream artifacts are integrity-specific | Include same-session finalizer recovery for `submit_integrity_consensus`; keep review stream / attempt artifacts integrity-owned |

## Design Principle

Same-session recovery must be a visible continuation of the worker session, not
a hidden synthetic prompt and not a whole-stage restart.

The orchestrator may decide to re-dispatch a failed stage, but the mechanism for
continuing the child session must live in the worker runner abstraction. The
orchestrator should pass a continuation intent and the prior child session id;
it should not hand-write finalizer prompts, inspect every terminal tool name, or
rebuild collectors itself.

## Proposed Architecture

### 1. Add a generic worker continuation input

Extend each resumable stage agent input with a common field:

```ts
continuation?: {
  sessionID: string
  artifactID: string
  reason: string
  kind: "protocol-finalizer-miss"
  finalizerName: string
  failedAssistantMessageID?: string
}
```

This is not a second retry system. It is the public, non-build name for the
existing `runAgentSession({ existingSessionID })` primitive.

The stage agent remains responsible for building its normal tools and collector,
then calls:

```ts
runAgentSession({
  ...normalInput,
  existingSessionID: input.continuation?.sessionID,
  continuation: input.continuation,
  buildUserPrompt: () => normalPrompt,
})
```

`runAgentSession`, not each stage module, owns the continuation user-message
append. When `continuation` is present, the runner ignores
`buildUserPrompt()` for the appended user message and instead builds a small
recovery message from the claimed continuation artifact: continue the existing
worker contract in this session, use the prior visible transcript as context,
and call the named finalizer. The normal prompt builder still exists for fresh
runs and for building the same tool/collector environment, but it must not be
used to restate or reinterpret scope from a new continuation tool call.

This makes claim, runtime-contract install, and visible continuation append one
runner-owned operation. No helper outside the runner appends a continuation user
message, and no stage module hand-writes a finalizer recovery prompt.

For terminal-tool agents, `finalizerName` is the terminal tool name, such as
`submit_frontend_template`. For structured-output agents, `finalizerName` is
`StructuredOutput`.

### 2. Extract build's generic continuation pattern

Keep these build-only responsibilities inside `BuildAgent.run`:

- worktree allocation and reuse.
- ownership markers.
- `goal_run` creation/finalization.
- merge_back, commit, diff, and actual changed files.
- build-session-contract artifacts.

Extract or mirror only this generic behavior:

- validate that a prior session is the expected kind.
- reopen the same child session.
- install a fresh `SessionRuntimeContract`.
- append one visible user message that tells the worker to finish the same
  contract.

No other agent should copy build's worktree or `goal_run` concepts.

### 3. Persist pending continuation contracts, not just stage sessions

The orchestrator already captures `runnerSessionID` for non-build stages, but it
does not persist a reusable "latest stage session" record consistently. A plain
"latest stage session" is not enough and must not drive continuation by itself:
normal user scope changes and intentional stage reruns would be indistinguishable
from protocol recovery.

Add one durable artifact only when a protocol-level finalizer miss is caught:

```ts
kind: "stage_continuation_request"
payload: {
  task_id: string
  stage: "requirements" | "architect" | "frontend-design" | ...
  session_id: string
  parent_session_id?: string
  normalized_stage_input: unknown
  input_digest: string
  original_user_message_id?: string
  original_worker_turn_descriptor_id?: string
  original_worker_turn_descriptor_hash?: string
  failure_name: "TerminalToolMissingError" | "StructuredOutputError"
  failure_message: string
  finalizer_name: string
  failed_assistant_message_id?: string
  claimed_at?: number
  claim_id?: string
  claim_failed_at?: number
  consumed_at?: number
  continuation_message_id?: string
  created_at: number
}
```

This artifact is not a gate for normal stage execution. It is an explicit,
visible pending recovery request created only from a typed protocol miss. It is
consumed exactly once when the orchestrator calls the same stage with the
matching `continuation_artifact_id`.

`normalized_stage_input` is a data-integrity snapshot of the original tool
scope, not a routing gate. When `continuation_artifact_id` is supplied, the
wrapper must either:

- reconstruct the continuation from this snapshot and ignore no caller-supplied
  scope fields because none are allowed in continuation mode; or
- require any re-supplied scope fields to normalize equal to this snapshot and
  return a visible mismatch result if they differ.

This prevents appending a new URL/focus/fact-check target/request scope to an
old child session. A scope mismatch is a data-integrity rejection, not a host
decision about whether the stage may run fresh: the orchestrator can immediately
call the same stage without `continuation_artifact_id` to start a new session.

The `input_digest` is evidence and diagnostics. It is used in the tool result so
the orchestrator LLM can see whether it is continuing the same request or
intentionally starting a fresh run after a scope change.

### 4. Classify only protocol-level finalizer misses

Reuse typed errors already stamped by `session/loop.ts`:

- `TerminalToolMissingError`
- `StructuredOutputError`
- runner-produced unsatisfied terminal collector errors

Do not retry:

- provider errors.
- budget/context overflow.
- schema/tool definition errors.
- explicit business-level failed reports.
- user/operator aborts.

The continuation kind is `protocol-finalizer-miss` so terminal-tool and
StructuredOutput failures share one protocol concept without lying about the
finalizer type.

The key difference from the earlier draft: `runAgentSession` should not
silently perform an internal hidden recovery loop before returning. Instead, it
should expose enough typed diagnostics for the stage tool/orchestrator to create
a visible pending continuation and let the orchestrator explicitly call the same
stage again.

### 5. Add a shared helper for stage tools

Create helpers near the orchestrator/tool persistence layer, for example:

```ts
createStageContinuationRequest({
  taskID,
  stage,
  error,
  runnerSessionID,
  activeContinuation,
  finalizerName,
}): { artifactID: string; sessionID: string; reason: string } | undefined

prepareStageContinuation({
  taskID,
  stage,
  continuationArtifactID,
  suppliedStageInput,
}):
  | AgentSessionContinuation
  | { mismatch: string }
  | { alreadyClaimed: string }
  | { alreadyConsumed: string }
  | { claimFailed: string }
  | undefined
```

They should do only mechanical mapping:

- confirm the error is a protocol-level finalizer miss before creating a
  pending request.
- persist the failed session id, finalizer name, typed failure, and failed
  assistant message id when available.
- resolve the failed child session id from `runnerSessionID` for fresh runs, or
  from `activeContinuation.sessionID` for continuation runs. The runner's
  `onSessionCreated` hook is not expected to fire for `existingSessionID`, so
  retry-of-retry must not report `not-created`.
- prepare only the explicit `continuation_artifact_id` supplied by the
  orchestrator tool call.
- validate the supplied stage scope against `normalized_stage_input`, or require
  continuation mode to omit fresh scope fields entirely.
- reject already-consumed continuation requests with a clear tool result rather
  than silently choosing another session.

It must not decide business policy like "rerun architect because goals are bad"
or "retry build because tests failed". Those remain orchestrator LLM decisions.

The runner owns claim and append. `prepareStageContinuation` validates scope and
loads the pending artifact, but it does not claim and does not append. The
returned `AgentSessionContinuation` is passed into `runAgentSession`.
`runAgentSession` then claims the request, installs the runtime contract, and
calls `SessionPrompt.prompt` with runner-built continuation parts that carry
`continuation_artifact_id` and `claim_id` metadata.

Claim and append must be atomic from the perspective of one artifact:

- if another turn already claimed, consumed, or terminally failed its claim,
  return a visible already-claimed / already-consumed / claim-failed result;
- if validation fails before the runner claims it, leave it unclaimed and
  return a visible mismatch result;
- if claiming succeeds but the continuation user message cannot be appended,
  mark `claim_failed_at` without `consumed_at` and return a visible
  infrastructure error. The same artifact is not reusable after
  `claim_failed_at`; the orchestrator can create a new continuation request
  from the visible failure instead of replaying an uncertain claim;
- if the continuation user message is appended, write `consumed_at` together
  with the appended continuation `message_id`. Model failure after that point
  must not make the artifact reusable, because replaying it would append a
  duplicate recovery message to the same child session.

`stage_continuation_request` is intentionally mutable only for `claim_id`,
`claimed_at`, `claim_failed_at`, `consumed_at`, and
`continuation_message_id`. That mutable state is the single source for
claim/consume status. If implementation chooses an append-only engine-artifact
style instead, it must use one derived status from
`stage_continuation_claimed` / `stage_continuation_consumed` companion events,
not parallel mutable and append-only status fields.

`runAgentSession` already owns `existingSessionID` validation and runtime
contract installation. This design extends that same runner boundary with
continuation claim/append so there is exactly one message owner.

### 6. Stage-agent API changes

Add `continuation` to:

- `RequirementsAgent.RunInput`
- `ArchitectAgent.CoordinateInput`
- `FrontendDesignAgent.AnalyzeInput`
- `GoalWorkloadAnalystAgent.AnalyzeInput`
- integrity review input
- `DeepResearchAgent.RunInput`
- `FrontendResearchAgent.RunInput`
- `VisualQaAgent.AnalyzeInput`
- `IntentAnalysisAgent.AnalyzeInput`
- fact-check run input

Each module maps `continuation.sessionID` to `existingSessionID`.

For `runResearchSession`, the function already creates a session and then calls
`runAgentSession(existingSessionID: session.id)`. Change it so an incoming
continuation session skips session creation and reuses that session after kind
validation.

### 7. Orchestrator behavior

On a stage tool failure:

1. For workflow-stage tools, mark the current workflow step failed as today.
   Optional side tools that do not own a workflow step skip this step and only
   return their normal visible tool result.
2. Record the typed failure in decision log / tool result.
3. If the failure is a protocol-level finalizer miss and a child session exists,
   create a `stage_continuation_request` artifact.
4. Return a normal visible `SubAgentProtocol.yieldResult` for that stage tool
   instead of rethrowing the protocol miss. The result must include:
   `session_id`, `continuation_artifact_id`, `finalizer_name`, typed failure
   name/message, and explicit next action: call the same stage with
   `continuation_artifact_id` and the same scope (or no fresh scope fields for
   stages whose continuation mode reconstructs from the artifact) to continue
   the child session, or call the stage without it to start a fresh run.
5. On the next orchestrator turn, the LLM explicitly passes
   `continuation_artifact_id` in the same stage tool input. The wrapper appends
   no message itself; it prepares the artifact and passes `continuation` to the
   stage agent. The runner claims the artifact and appends the continuation
   user message.

Do not auto-loop inside the orchestrator tool implementation. Do not
automatically pick the "latest" pending continuation. The orchestrator turn must
make the choice visible by passing the artifact id.

For non-protocol failures, keep the existing failure behavior unless the
specific tool already returns a visible failure result for its own workflow
contract. The change here is only to make finalizer protocol misses visible and
recoverable; it does not convert all agent failures into success-shaped tool
results.

### 8. Direct reply / steer_subagent

Do not use generic `steer_subagent` as the recovery mechanism.

Reason: it can append a visible user message, but it does not necessarily
rebuild the stage-specific tool kit and collector after the original runner
call has unwound. It is correct for human steering while a runtime contract is
live; it is not the durable stage retry API.

However, the same lower-level idea is valid: visible message + same session +
fresh runtime contract. The stage retry path should implement that through
`runAgentSession(existingSessionID)`.

## Implementation Plan

1. Revert the earlier runner-owned automatic finalizer loop in
   `packages/opencorvus/src/agent/runner.ts`. Keep typed error helpers if they
   are useful, but do not leave an internal retry loop.
2. Add a first-class `continuation` input to `runAgentSession` plus a small
   shared `AgentSessionContinuation` type.
3. Add `continuation` input fields to the listed stage agents.
4. Thread `continuation.sessionID` into `runAgentSession(existingSessionID)`,
   and pass the full continuation object so the runner owns claim/append.
5. Add `continuation_artifact_id` optional input fields to orchestrator stage
   tools that can be continued.
6. Ensure every such orchestrator tool captures `runnerSessionID`; visual-qa
   and fact-check are known gaps and must pass `onSessionCreated`.
7. Add `stage_continuation_request` to the closed engine artifact kind union
   and create typed persist/query/claim helpers. Do not write this artifact
   through casts or ad hoc JSON inserts.
8. Add `stage_continuation_request` artifact creation/consumption helpers.
9. Add a shared finalizer-miss classifier used by orchestrator tool catches.
10. Update orchestrator stage tools to surface continuation-ready failures and
   pass continuation only when the LLM supplies `continuation_artifact_id`.
11. Keep build's existing path but align naming/comments so build is one user of
   the common continuation model, not a special parallel architecture.

## Tests

Runner-level:

- `runAgentSession(existingSessionID)` appends to the existing child session and
  installs a fresh runtime contract.
- `runAgentSession(continuation)` claims the continuation artifact and appends
  exactly one visible continuation user message carrying the artifact id,
  claim id, and appended message id.
- continuation rejects wrong kind / wrong goal / wrong directory.
- terminal miss remains typed and does not get swallowed by a hidden retry loop.

Stage-agent unit tests:

- frontend-design continuation passes `existingSessionID` and produces a visible
  recovery user message requiring `submit_frontend_template`.
- requirements continuation passes `existingSessionID`.
- architect continuation passes `existingSessionID`.
- research continuation reuses the provided research session instead of creating
  a second child session.
- visual-qa continuation passes `existingSessionID`.
- intent-analysis continuation passes `existingSessionID` and requests
  `StructuredOutput`.
- fact-check continuation passes `existingSessionID` and requests
  `report_fact_check_result`.
- integrity continuation passes `existingSessionID` and requests
  `submit_integrity_consensus` without duplicating integrity review stream
  ownership.

Orchestrator tool tests:

- frontend-design terminal miss records a failed visible result with
  `session_id`, `continuation_artifact_id`, and continuation-ready guidance.
- same-stage re-dispatch with the explicit `continuation_artifact_id` reuses the
  same session id and marks the request consumed.
- same-stage re-dispatch without the artifact id starts a fresh stage run and
  does not implicitly continue the pending session.
- already-consumed continuation artifact is rejected with a visible tool result.
- user scope change followed by a normal stage call does not append to the old
  failed session.
- user scope change combined with an old `continuation_artifact_id` is rejected
  visibly and does not append a message to the old failed session.
- concurrent attempts to consume the same continuation artifact append at most
  one continuation user message.
- the consumed artifact's `continuation_message_id` matches the actual visible
  continuation user message in the child session.
- if continuation model contact fails after the continuation user message is
  appended, the artifact remains consumed so the same recovery message is not
  replayed.
- provider/budget errors do not produce continuation.
- build still rejects generic direct reply and continues through
  `BuildAgent.run(existingSessionID)`.
- requirements, architect, workload analysis, integrity, visual-qa,
  frontend-research, deep-research, intent-analysis, and fact-check protocol
  misses each have a message-flow test or targeted tool test proving the failed
  session id is visible and continuable.

Message-flow tests:

- child session is visible when started.
- failed terminal miss is visible as session terminal error.
- retry/continuation message appears as a normal user message inside the same
  child session.
- final terminal tool result appears in the same child session, not a new card.
- StructuredOutput miss follows the same visible continuation path with
  `finalizer_name=StructuredOutput`.

## Acceptance Criteria

- No per-agent retry loops.
- No hidden/synthetic recovery messages.
- No generic orchestrator "retry agent from scratch" for terminal finalizer
  misses when a same-session continuation is available.
- No implicit latest-session continuation; continuation requires an explicit
  visible `continuation_artifact_id`.
- Pending continuation requests are consumed once and cannot silently replay.
- `build` keeps its worktree/goal_run behavior but shares the same conceptual
  continuation API.
- The frontend-design incident class can be recovered by re-dispatching
  frontend-design into the original session, preserving the prior reads and
  evidence transcript.
