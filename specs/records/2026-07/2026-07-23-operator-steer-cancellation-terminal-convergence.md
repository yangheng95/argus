# Operator Steer Cancellation Terminal Convergence

Date: 2026-07-23
Status: Implemented; full-suite validation is blocked by unrelated concurrent refactors
Owner: Codex

## Recall

### User request

The user supplied live Task debug evidence for
`tsk_f8d4b4ccf001l81Ax2Bk2PZGAS`, asked why targeted steer appeared to do
nothing, confirmed this is an Agent OS infrastructure problem, and requested
the problem be repaired.

The observed operator steer was:

- request: `art_f8ede5357001Z4TVIrKAqWdKPI`
- target Session: `ses_0717c6be5ffeMo2xARauv9d4kl`
- target Goal run: `422b084a`
- operator message: `继续完成任务`

The same Task later received a separate task-root operator message
`重启G6`. The Orchestrator chose `cancel_worker`, the worker and Goal run
became terminal-aborted, but the coordination action was recorded failed and
the original request remained pending. The Orchestrator then dispatched a new
Goal run without a coordination action binding.

### Acceptance criteria

- Overlay-targeted steer remains the single
  `POST /task/:taskID/session/:sessionID/operator-steer` protocol and never
  becomes a task-root message or direct child-session reply.
- A successful `202` response is presented as a durable request accepted for
  Orchestrator handling, not as guidance already delivered to the worker.
- A typed projected-worker cancellation is not persisted as a failed dispatch
  ownership outcome.
- `cancel_worker` converges the worker Session, Goal run, dispatch ownership,
  coordination response/action, and request to one consistent terminal fact
  even when worker settlement races the cancellation caller.
- A later task-root instruction may change the scheduling decision, but the
  targeted request must close through its visible response/action chain; it
  must not remain pending while an unbound replacement dispatch starts.
- No host route gate, keyword classifier, compatibility path, hidden message,
  synthetic message, or second steer source is introduced.
- Focused unit/integration tests reproduce the live race and the accepted
  steer user experience.
- Because the Overlay changes, a real isolated page must be started, captured,
  inspected, and corrected before acceptance.

### Hard constraints

- Preserve unrelated existing modifications in:
  - `specs/records/2026-07/2026-07-22-mirror-prism-full-workflow-distillation.md`
  - `specs/records/2026-07/2026-07-23-retire-execution-liveness-and-task-run.md`
  - `expert-squads/.DS_Store`
- Do not restart, stop, refresh, or otherwise intervene in the running
  OpenCorvus/Overlay process.
- Do not create a worktree.
- Commit subjects use the required `dsw-33987` prefix.
- Push the completed main-worktree result to `legacy-remote/v0.0.17beta`.

### Persisted sources read

- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/records/2026-06/2026-06-29-operator-steer-single-source.md`
- `specs/records/2026-07/2026-07-23-coordination-continuation-terminal-convergence.md`
- live runtime Task, Session, Message, Part, protocol-event, tool-ownership,
  Goal-run, coordination-request, response, and action evidence listed above

### Whole-repository grep

Commands:

```text
rg -n "operatorSteerAgentSession|operator-steer|sendOperatorSteer|OperatorSteer" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test
rg -n "cancelLiveOwnedDispatch|Tool ownership .*already terminal|refusing conflicting cancelled replay|tool-ownership-terminal" packages/opencorvus/src packages/opencorvus/test
rg -n "coordination_action_id|respond_agent_coordination|pending_agent_coordination" packages/opencorvus/src/prompt packages/opencorvus/src/orchestrator packages/opencorvus/test/orchestrator
rg -n "completeDispatchOwnershipLifecycle|completeTerminal|ExecutionCancellationError|isExecutionCancellationError" packages/opencorvus/src packages/opencorvus/test
```

Call-site disposition:

| Surface | Current responsibility | Repair |
| --- | --- | --- |
| `overlay/src/components/Card.tsx` | Sends every inline worker steer through `sendOperatorSteer`. | Keep the single route; return accepted-request feedback to the shared form. |
| `overlay/src/components/ChatBubble.tsx` | Same single steer service for conversation Agent bubbles. | Keep behavior aligned with Card. |
| `overlay/src/components/AgentSessionReplyBox.tsx` | Clears the draft on HTTP success and shows no accepted/pending semantic. | Show a non-terminal accepted notice with the exact Orchestrator request identity. |
| `overlay/src/services/task.ts` | Posts target-scoped operator intent and returns `request_id` plus wake status. | Keep as the only Overlay write source. |
| `task-api/index.ts::operatorSteerAgentSession` | Validates target/ownership, writes the request, and wakes the Orchestrator. | Preserve; no direct worker append or task-root fallback. |
| `engine/agent-coordination.ts` | Owns request/response/action and dispatch-ownership terminal records. | Preserve strict identities; use existing action lifecycle as the only closure surface. |
| `orchestrator/tools.ts::respond_agent_coordination` | Chooses and executes continue/cancel/redispatch/ask/fail actions. | Make cancellation settle from typed terminal evidence and keep request/action coherent under races. |
| `orchestrator/subagent-cancellation-runtime.ts` | Cancels a live owned dispatch and expects ownership cancellation to settle. | Keep as the cancellation authority. |
| `engine/writer.ts::abortLiveOrchestratorToolOwnership` | Cancels prompt/Goal/tool execution, waits for settlement, then closes ownership as cancelled. | Preserve as the cancellation terminal writer. |
| `orchestrator/build-tool.ts::failBuild` | Currently records every adapter exception as ownership `failed`, including typed cancellation. | Re-throw typed cancellation without writing failure so the cancellation authority writes `cancelled`. |
| `orchestrator/dispatch-agent-tool.ts` | Avoids invocation completion for typed execution cancellation. | Preserve; this is already the correct outer contract. |
| `prompt/core/orchestrator-core.txt` | Requires pending coordination cancellation to use `respond_agent_coordination`. | Add exact operator-steer/request closure guidance; do not add a host gate. |
| `test/orchestrator/tools.test.ts` | Covers normal cancel and stale terminal recovery but not the live adapter terminal-write race. | Add the missing concurrent terminal-ownership regression. |
| `test/server/task-session-operator-steer.test.ts` | Covers durable request creation and wake. | Preserve exact operator message and no-root/no-child-message coverage. |
| Overlay service/source/browser tests | Cover single route, structured errors, and accepted/error rendering. | Add accepted-awaiting-Orchestrator copy and screenshot assertions. |

### Independent Agent feedback

No sub-agent was started because the active developer instruction forbids
delegation unless the user explicitly requests sub-agents. The primary agent
owns the required second review.

## Evidence-backed cause

The visible symptom was a pending operator steer, but the direct failure chain
was:

1. The operator-steer route correctly wrote one durable request and woke the
   Orchestrator.
2. A later task-root operator message requested a G6 restart, so the
   Orchestrator chose cancellation rather than same-session continuation.
3. `abortLiveOrchestratorToolOwnership` cancelled the prompt and Goal run, but
   Build's generic `failBuild` path observed the cancellation exception first
   and completed the transferred ownership as `failed`.
4. The cancellation authority then attempted to complete the same ownership
   as `cancelled`; strict terminal replay correctly rejected the conflicting
   second outcome.
5. `respond_agent_coordination` marked its action failed and kept the request
   pending even though durable worker/Goal abort evidence existed.
6. A later unbound dispatch created the replacement G6 Session, leaving the
   old request unresolved.

The tool error was therefore not the root cause. The root cause is two writers
competing to classify the same typed cancellation plus insufficient prompt
guidance to close the existing request before a replacement dispatch.

## Design

### Typed cancellation ownership

The Build adapter must distinguish `ExecutionCancellationError` from a product
or tool failure. It rethrows cancellation unchanged and does not call
`completeTerminal("failed")`. The outer dispatch layer already leaves
ownership completion to the explicit cancellation path for this typed error.
`abortLiveOrchestratorToolOwnership` remains the sole terminal writer and
records `cancelled` only after prompt/Goal/tool settlement.

No “already failed means cancelled” compatibility rewrite is allowed.
Conflicting terminal facts remain errors; the repair prevents the wrong first
fact.

### Coordination closure

The Orchestrator prompt must treat each pending operator-steer request as an
exact target-scoped durable input. A later task-root message can change the
chosen action, but it cannot bypass the request:

- answer the existing request through `respond_agent_coordination`;
- if a replacement worker is required, create the redispatch action and pass
  its exact `coordination_action_id` to `dispatch_agent`;
- do not start an unbound replacement while the request remains pending.

This is model guidance and correct data flow, not a host-side route gate.

### Overlay semantics

The inline form must distinguish:

- submitting the HTTP request;
- accepted for Orchestrator handling, with the exact request identity;
- structured request rejection.

The accepted notice is informational, not terminal success. It displays the
request identity so an operator can correlate the visible coordination record.

## Verification

- focused cancellation and operator-steer tests
- OpenCorvus typecheck
- Overlay typecheck and focused component/service tests
- real operator-steer request-to-Orchestrator-to-worker message-flow test
- historical docs links, docs single-source, and document-health tests
- isolated Overlay browser test with screenshot inspection
- `git diff --check`
- independent second review by the primary agent

### Verification evidence captured

- `bun test packages/opencorvus/test/orchestrator/projected-adapter-error.test.ts packages/opencorvus/test/orchestrator/orchestrator-core-prompt.test.ts packages/overlay/test/agent-session-controls.test.ts packages/overlay/test/agent-reply-box-structured-errors.test.ts`: the focused cancellation, prompt, single-route, and UI contract tests pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 tests pass.
- `bun run check:i18n` in `packages/overlay`: panel locale parity passes.
- `node test/browser-runner.mjs test/browser/agent-reply-box-primitives.test.ts` in `packages/overlay`: the real Node/Playwright path passes, including accepted request submission, exact request-ID receipt, structured retryable failure, and screenshot capture.
- `.scratch/agent-reply-box-operator-accepted.png` was inspected at original resolution; the textarea, disabled Steer button, receipt spacing, contrast, and long request ID render correctly.
- Overlay focused unit tests pass, and `git diff --check` reports no whitespace errors.
- Full OpenCorvus/Overlay typechecks and server/tools integration imports are temporarily blocked by unrelated concurrent main-worktree refactors: the Task Run/liveness worktree currently has removed producers with remaining consumers, and the interactive-artifact task is between schema and renderer updates. These failures occur before the operator-steer tests execute and are not treated as acceptance.
