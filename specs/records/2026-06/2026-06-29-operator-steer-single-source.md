# 2026-06-29 Operator Steer Single Source

Status: implementation in progress

## Goal

Eliminate the current multi-source sub-agent steer design. Overlay steer input
must have one backend write protocol and one durable visible semantic source.
It must not split between direct child-session reply, build task-root operator
messages, and A2A coordination artifacts.

The single source for overlay-originated sub-agent steer will be an
operator-authored coordination artifact chain owned by the task orchestrator:

- one target-scoped operator steer request;
- one visible orchestrator-owned response/action decision;
- one concrete visible action, such as same-session continuation, cancellation,
  redispatch, user question, or task failure.

Direct session reply may remain only as a non-overlay low-level route for
explicitly scoped continuation tests and internal protocol compatibility. It is
not an overlay steer source. Task-root messages remain ordinary task-level user
input, not build steer.

## Recall

### User Request

The user asked why sub-agent steer still returns 400 and why OpenCorvus still
has a multi-source agent design. The requested goal is to thoroughly remove the
multi-source steer design and replace overlay-side direct session reply, build
task-root operator message, and A2A mailbox split behavior with one operator
steer protocol.

### Acceptance Criteria

- Specs: this record must preserve the full task requirements, current
  constraints, and grep evidence before implementation.
- Backend: overlay steer has one write route and one durable artifact/action
  semantics. It must not fallback to task-root messages or direct replies.
- Overlay: every inline sub-agent steer box calls the same service function and
  backend route. Card and ChatBubble must not branch on build/non-build for
  steer.
- Coverage: build, explore, frontend-research, visual-qa, fact-check,
  deep-research, goal-workload-analyst, requirements, frontend-design,
  architect, integrity, and intent-analysis are all targetable through the same
  operator steer API.
- Errors: invalid target, pending A2A, missing runtime contract, build live
  ownership, and stale/terminal sessions produce structured visible errors, not
  fallback behavior.
- Tests: backend route, overlay service, source-level anti-regression tests,
  real browser visual tests, and docs/spec health tests must pass.
- Review: independent agents must adversarially review the implementation until
  no new issue is found.

### Hard Constraints

- No fallback or compatibility alias for overlay steer.
- No task-root spoofing for targeted sub-agent steer.
- No direct-reply whitelist expansion to make worker kinds accept generic
  direct replies.
- No UI gate that simply hides the problem.
- No hidden/synthetic/private messages.
- No host-side state-machine routing that teaches the model a path while
  preserving multiple sources.
- No keyword parsing from text such as `Target build session:`.
- Build direct reply stays forbidden.
- A2A request/response/action remains visible and durable.
- Direct reply may survive only when explicitly documented as outside overlay
  steer.

### Read Persisted Plans

| Source | Relevant Constraint |
| --- | --- |
| `specs/current/architecture/13-agent-communication-matrix.md` | Worker-to-orchestrator scheduling is the durable A2A mailbox; task-root messages, direct reply, hidden notes, same-kind redispatch, and historical `steer_subagent` are not scheduling protocol. |
| `specs/records/2026-06/2026-06-10-build-card-steer-operator-guidance.md` | Build direct reply was correctly rejected, but this record introduced the overlay build task-message split that must now be replaced for overlay steer. |
| `specs/records/2026-06/2026-06-13-build-steer-live-ownership-interrupt-fix.md` | Build steer as task message created live-ownership interrupt hazards. Source/target must be structured and durable, not parsed from text. |
| `specs/records/2026-06/2026-06-24-remove-steer-subagent-tool.md` | `steer_subagent` was removed and must not return as a compatibility surface or replacement probe. |
| `specs/records/2026-06/2026-06-24-a2a-agent-lifecycle-coordination.md` | A2A request/response/action introduced the durable mailbox and explicitly rejected unsolicited private steering. |
| `specs/records/2026-06/2026-06-26-enterprise-a2a-protocol-root-repair.md` | Current implementation contract requires request/response/action atomicity, durable wake, no direct-reply fallback, and visible projection. |
| `specs/records/2026-06/2026-06-27-a2a-adversarial-audit.md` | Explicitly states operator steer is still not A2A single-source: non-pending direct reply, build card task message, task message/inject/retry/replan, and session cancel are still separate surfaces. |
| `specs/current/architecture/01-agents.md` | Current orchestrator tool surface still lists task-control tools and `respond_agent_coordination` as worker request response. Operator steer must be documented as a targeted operator-originated coordination request, not a new orchestrator tool. |
| `specs/current/architecture/16-unified-teardown.md` | Historical architecture says user/operator messages enter the orchestrator session first. This is true for task-root messages but must not remain the model for targeted sub-agent steer. |

### Full-Repository Grep Evidence

#### Overlay multi-source steer

`rg -n "replyToAgentSession|sendTaskOperatorMessage|directAgentReplyMode|overlay_build_steer|AgentSessionReplyBox" packages/overlay/src packages/overlay/test`

| Surface | Current Evidence | Required Action |
| --- | --- | --- |
| `packages/overlay/src/components/Card.tsx` | Imports `replyToAgentSession` and `sendTaskOperatorMessage`; computes `directAgentReplyMode`; build posts `overlay_build_steer`; non-build calls `replyToAgentSession`. | Replace with one `sendOperatorSteer(...)` call. Remove build/non-build steer branching. |
| `packages/overlay/src/components/ChatBubble.tsx` | Same split as Card. | Replace with same single service call. |
| `packages/overlay/src/services/task.ts` | Exposes `replyToAgentSession` and `sendTaskOperatorMessage`. | Add one overlay steer service. Keep direct reply service only if no overlay caller remains. |
| `packages/overlay/test/agent-session-controls.test.ts` | Tests `replyToAgentSession`, `sendTaskOperatorMessage`, and source-level assertions that Card/ChatBubble preserve both paths. | Replace with tests that Card/ChatBubble do not use either path for steer and call the one steer service. |
| `packages/overlay/test/browser/agent-reply-box-primitives.test.ts` | Browser fixture still models `/session/:sessionID/reply` and `/task/:taskID/message` steer outcomes. | Replace with single route fixture and visual evidence for accepted/pending/error outcomes. |

#### Direct reply source

`rg -n "replyAgentSession|appendDirectAgentSessionReply|resolveDirectReplyTarget|overlay_direct_reply|overlay_agent_session_reply|/task/:taskID/session/:sessionID/reply|task\\.session\\.reply" packages/opencorvus/src packages/opencorvus/test`

| Surface | Current Evidence | Required Action |
| --- | --- | --- |
| `packages/opencorvus/src/task-api/index.ts::appendDirectAgentSessionReply` | Appends `overlay_direct_reply` user messages directly to child sessions and resumes them. | Remove overlay steer dependence. Keep as non-overlay direct reply only if API/tests rename the boundary. |
| `packages/opencorvus/src/server/routes/orchestrator.ts` | `POST /task/:taskID/session/:sessionID/reply` remains a public route. | Do not use from overlay steer. Consider route description update to say it is not overlay operator steer. |
| `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | Treats `overlay_direct_reply` as a human overlay reply. | Ensure new operator steer projection is not another message source and does not reuse this marker. |
| `packages/opencorvus/test/server/task-conversation-routes.test.ts` | Asserts direct reply appends `overlay_direct_reply`. | Preserve only as direct-reply boundary test, not overlay steer acceptance. |
| `packages/opencorvus/test/server/reply-error-taxonomy.test.ts` | Asserts structural direct-reply errors do not fall back to task-root. | Keep and add tests that overlay steer also never falls back. |

#### Build task-message source

`rg -n "overlay_build_steer|operator_message|sendTaskOperatorMessage|TaskMessageInput|appendAndWakeTaskOperatorMessage|handleTaskMessage|/task/:taskID/message" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`

| Surface | Current Evidence | Required Action |
| --- | --- | --- |
| `packages/overlay/src/components/Card.tsx` / `ChatBubble.tsx` | Build steer posts `source: "overlay_build_steer"` to task message route. | Remove from overlay steer. |
| `packages/opencorvus/src/task-api/index.ts::handleTaskMessage` | Task-root operator message persists `operator_message` metadata and wakes scheduler. | Keep as ordinary task-root input, not targeted steer. |
| `packages/opencorvus/test/server/task-message-routes.test.ts` | Tests build steer task message queues behind live build owners. | Replace overlay steer coverage with operator steer route; keep generic task message tests as task-root input. |
| `packages/opencorvus/test/orchestrator/tools.test.ts` | `inject_operator_message` reads `overlay_build_steer`. | Remove build steer as overlay steer expectation. |

#### A2A source

`rg -n "agent_coordination_request|agent_coordination_response|agent_coordination_action|createAgentCoordinationRequest|createAgentCoordinationResponse|respond_agent_coordination|request_orchestrator_decision|listPendingAgentCoordinationSessionControlRequests" packages/opencorvus/src packages/opencorvus/test`

| Surface | Current Evidence | Required Action |
| --- | --- | --- |
| `packages/opencorvus/src/engine/agent-coordination.ts` | Durable request/response/action artifacts already exist and cover concrete stage redispatch bindings. | Reuse this artifact family for operator steer rather than inventing a fourth store. |
| `packages/opencorvus/src/orchestrator/tools.ts::respond_agent_coordination` | Orchestrator private tool consumes pending worker requests and writes response/action. | Operator steer should wake orchestrator with a pending operator-originated coordination request/action context rather than directly appending worker messages in the route. |
| `packages/opencorvus/src/tool/request-orchestrator-decision.ts` | Worker-originated request tool creates A2A request. | Add host/API-originated operator steer request helper, not a worker tool call. |
| `packages/opencorvus/test/orchestrator/tools.test.ts` | Broad tests for continue/cancel/redispatch/ask/fail on A2A. | Add operator-originated request cases and ensure existing response tool can answer them. |

### Independent Agent Feedback

Three read-only agents were started for:

1. backend A2A/direct-reply/root-cause audit;
2. overlay UI/service/test audit;
3. specs/docs/test-health audit.

The overlay review found:

- `Card.tsx` and `ChatBubble.tsx` duplicate the same build/non-build steer
  router.
- `AgentSessionReplyBox` comments hard-code direct reply for non-build and task
  message for build.
- `agent-session-controls.test.ts`,
  `agent-reply-box-structured-errors.test.ts`, and
  `agent-reply-box-primitives.test.ts` currently protect multi-source behavior.
- The review proposed using `POST /task/:taskID/message` as the only overlay
  route because `TaskMessageTarget` already supports `agent_session` and
  `build_session`.

Decision: do **not** use `/task/:taskID/message` as targeted operator steer.
That route is task-root operator input and remains part of the multi-source
problem. Reusing it would remove the UI branch while preserving the wrong
semantic source. The single source must be a target-scoped operator steer route
that writes coordination artifacts and wakes the orchestrator without writing a
task-root user message.

The specs/tests review found:

- `2026-06-27-a2a-adversarial-audit.md` already states operator steer is not
  A2A single-source.
- New work must explicitly supersede the 2026-06-10 / 2026-06-13 build steer
  task-root guidance records and the 2026-06-17 bug-hunt repair plan sections
  that framed build guidance as task-root operator input.
- Current architecture records (`01-agents.md`, `13-agent-communication-matrix.md`,
  `16-unified-teardown.md`) must be reconciled after implementation.
- `document-health.test.ts` should pin any now-conflicting historical records as
  superseded, or they will remain active-looking evidence for the old design.

The backend review found:

- Current overlay steer writes through at least `/task/:taskID/message`,
  `/task/:taskID/session/:sessionID/reply`, and `respond_agent_coordination`;
  `/task/:taskID/inject` is also task-root operator-message input and must not
  become targeted steer.
- `/interaction/:interactionID/reply|reject` is a legitimate human-input path
  for permission/question interactions and is not sub-agent steer.
- The minimal root fix should be `EngineService.operatorSteer(...)` plus one
  explicit route. It must reuse agent coordination ownership validation and
  pending-session-control checks before writing anything.
- Do not delete `replyAgentSession`, `handleTaskMessage`, interaction replies,
  or `respond_agent_coordination`; instead remove overlay steer dependence and
  prevent task-root scoped target spoofing from being the targeted steer path.
- Existing direct-reply tests that prove no fallback and healthy explicit
  direct reply should stay, but targeted steer needs its own route tests proving
  no root message, no child message, no fallback, and correct ownership
  validation.

## Design

### Single Backend Entry

Add one overlay-facing route:

```text
POST /task/:taskID/session/:sessionID/operator-steer
```

The request body contains only operator steer intent:

```ts
{
  message: string
}
```

Attachments are intentionally not included in this first implementation. The
existing attachment-bearing task-root message and direct-reply paths are not
valid substitutes. If targeted steer attachments are needed later, they must be
added to this same route and artifact family.

### Single Durable Semantic Source

The route creates an operator-originated coordination request using the existing
`agent_coordination_request` artifact family, with explicit provenance fields:

```ts
origin: "operator_steer"
operator_message: string
```

The request binds to:

- `task_id`
- target `session_id`
- target agent/session kind
- optional `goal_id` / `goal_run_id`
- current task root/orchestrator context if available
- an idempotency key derived from API request identity when available

The route does not append a worker user message. It does not call
`replyAgentSession`. It does not call `handleTaskMessage`. It wakes the task
orchestrator with source kind `coordination_request`.

The orchestrator remains the only decision owner. It reads the pending request
from normal task description context and answers with existing
`respond_agent_coordination` decisions:

- `continue` to append one visible worker message and resume the same session
  when runtime contract validates;
- `redispatch` for concrete stage retry/redispatch;
- `cancel_worker`;
- `ask_user`;
- `fail_task`.

### Why Not Directly Call `respond_agent_coordination` From The Route

The route is operator input, not an orchestrator tool call. Calling
`respond_agent_coordination` directly would fabricate orchestrator tool
execution identity and violate the existing response audit contract. The route
must create the pending request and wake the real orchestrator turn.

### Why Not Accept Direct Reply For All Worker Kinds

That would enlarge `DIRECT_REPLY_AGENT_KINDS` into a hidden scheduler bypass.
It would skip coordination request/response/action artifacts, pending A2A
guards, build runtime-contract ownership, and orchestrator decision ownership.

### Why Not Keep Build Task Message As A Special Case

Build is the original high-value operator steer case. Keeping build as
`overlay_build_steer` on `/task/:taskID/message` preserves the exact multi-source
bug. Build must use the same operator steer route and the same request/action
artifact chain as every other sub-agent.

## Implementation Plan

1. Add operator-originated request fields and helpers in
   `packages/opencorvus/src/engine/agent-coordination.ts`.
2. Add `EngineService.operatorSteerAgentSession(...)` in
   `packages/opencorvus/src/task-api/index.ts`.
3. Add `POST /task/:taskID/session/:sessionID/operator-steer` in
   `packages/opencorvus/src/server/routes/orchestrator.ts`.
4. Add overlay service function `sendOperatorSteer(taskID, sessionID, message)`.
5. Update `Card.tsx` and `ChatBubble.tsx` to call only `sendOperatorSteer`.
6. Update `AgentSessionReplyBox` comments and error taxonomy to operator steer
   names as needed.
7. Replace overlay tests that assert build/non-build split with single-route
   tests and source scans forbidding `replyToAgentSession` /
   `sendTaskOperatorMessage` in Card/ChatBubble steer handlers.
8. Add backend tests:
   - accepted operator steer creates one coordination request and no root/worker
     message;
   - build target uses the same route and does not write `overlay_build_steer`;
   - pending existing A2A request either joins or reports a structured conflict
     without duplicate hidden messages;
   - invalid/root/foreign session returns structured error;
   - missing runtime contract is handled by orchestrator decision, not route
     fallback.
9. Update browser test to use the single route for every current sub-agent
   stage and capture screenshots for accepted request and structured error.
10. Update docs/spec indexes and health tests.
11. Run independent agent review. Incorporate findings and repeat until no new
    issue is found.

## Tests And Verification

Initial targeted commands:

```powershell
bun test packages/opencorvus/test/engine/agent-coordination.test.ts --test-name-pattern "operator steer|coordination request"
bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination|operator steer"
bun test packages/overlay/test/agent-session-controls.test.ts
$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test packages/overlay/test/browser/agent-reply-box-primitives.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Final verification must also include a source scan proving overlay steer no
longer references these as steer paths:

```powershell
rg -n "directAgentReplyMode|overlay_build_steer|sendTaskOperatorMessage\\(|replyToAgentSession\\(" packages/overlay/src/components packages/overlay/src/services
```

The scan may still find `sendTaskOperatorMessage` or `replyToAgentSession` only
if they are explicitly outside overlay steer and have tests proving they are not
called by Card/ChatBubble steer controls.

## Non-Acceptance

The repair is not accepted if any of these remain true:

- Card or ChatBubble choose steer route based on build/non-build session kind.
- Overlay steer calls `/task/:taskID/message`.
- Overlay steer calls `/task/:taskID/session/:sessionID/reply`.
- A failed operator steer is rewritten into task-root input.
- Build uses a different backend steer path than other sub-agents.
- The route directly appends a worker session user message before orchestrator
  decision.
- The route fabricates `respond_agent_coordination` tool identity.
- Any target-specific steer machine semantics are parsed from visible text.
- Independent review finds a new double source or fallback and it remains
  unresolved.

## Current Worktree Implementation Log

2026-06-29 current IDE worktree slice:

- Added `POST /task/:taskID/session/:sessionID/operator-steer`.
- Added `EngineService.operatorSteerAgentSession(...)`.
- Added strict `AgentSessionOperatorSteerInput` /
  `AgentSessionOperatorSteerResult`.
- Added operator-originated `agent_coordination_request` creation with
  `origin: "operator_steer"` and `operator_message`.
- Overlay `Card.tsx` and `ChatBubble.tsx` now call `sendOperatorSteer(...)`
  instead of choosing between direct reply and task-root build message paths.
- `TaskMessageTarget` / target-scoped task-root message input is removed from
  source and generated SDK/OpenAPI artifacts in this worktree.
- `AgentSessionReplyBox` now describes the one operator-steer route and keeps
  structured error handling for visible steer failures.
- Operator steer target validation is derived from
  `AgentRoleContract.controlSurface === "task-worker"` plus
  `agentOwnedSessionKind`, so primary/helper/host surfaces are not silently
  steerable worker targets.

Verified in this worktree:

- `bun test packages/opencorvus/test/server/task-session-operator-steer.test.ts`
  passed: 10 pass, 0 fail.
- `bun test packages/overlay/test/agent-session-controls.test.ts` passed as
  part of the first targeted run.
- `bun test packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "target-scoped|triggers scheduler|queues behind multiple live build owners|does not interrupt async goal"`
  passed in isolation: 4 pass, 0 fail.
- `bun test packages/opencorvus/test/server/reply-error-taxonomy.test.ts`
  passed: 11 pass, 0 fail.
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "respond_agent_coordination continue consumes|respond_agent_coordination continue supports frontend-research|respond_agent_coordination redispatch starts the build stage dispatcher|respond_agent_coordination redispatch starts the explore stage dispatcher|respond_agent_coordination cancel_worker completes"`
  passed: 5 pass, 0 fail.
- `cd packages/overlay; node test/browser-runner.mjs test/browser/agent-reply-box-primitives.test.ts`
  passed: 1 pass, 0 fail. Screenshot
  `.scratch/agent-reply-box-operator-target-error.png` was visually reviewed
  for preserved draft, visible Steer button, and non-overlapping structured
  error panel.
- `bun run typecheck`, `bun run api:routes-check`, `bun run docs:check`, and
  docs health tests passed after current-worktree edits.
- Source scans found no `directAgentReplyMode`, `overlay_build_steer`,
  `sendTaskOperatorMessage(`, or `replyToAgentSession(` in overlay steer
  components/services, and no `TaskMessageTarget` in backend/SDK/OpenAPI scan.

Not yet sufficient for completion:

- A combined Bun process containing `task-session-operator-steer.test.ts`,
  `runner-tool-scope.test.ts`, and `session-agent.test.ts` hit test fixture
  cleanup/SQLite foreign-key noise; the operator steer route file passed when
  isolated, so follow-up verification should keep server integration files
  isolated unless the shared fixture issue is being debugged directly.
