# P0 Stateful MCP, Coordination, And Cancellation Convergence

Date: 2026-07-21
Status: Implementation in progress; stateful MCP ownership, typed Visual QA failure, terminal coordination handoff, typed cancellation, and durable cancelled-session publication implemented
Owner: Codex with independent read-only audits and correctness reviews

## Recall

### User requirement

- Treat Task `tsk_f802684850012OpovnGW0NRPJb` as a P0 (Priority 0, highest-priority) incident.
- Use independent Agents to form a systemic repair plan rather than patching the visible stuck Task.
- Independently re-review the proposed repair for correctness and architectural soundness before implementation.
- Explain and repair the complete causal chain: Browser session loss, Visual QA non-termination, worker-to-Orchestrator coordination livelock, cancellation conflict, stale streaming session projection, and contradictory Task completion.

### Acceptance criteria

1. A projected stateful MCP (Model Context Protocol) server uses one explicit runtime connection owner for every tool in the same projected Agent session; `session_create` followed by `navigate`, `observe`, `screenshot`, and `session_destroy` must execute against that same server process and state.
2. A worker that needs an Orchestrator decision can perform one visible terminal coordination handoff without first satisfying an impossible domain finalizer and without queueing an unbounded number of wakes behind its own live ownership.
3. Visual QA preserves strict fresh rendered-evidence semantics. It can separately report an execution failure backed by current tool evidence without manufacturing a visual verdict, acceptance result, or screenshot.
4. Cancelling a live `dispatch_agent` produces one exact ownership outcome. Typed cancellation cannot first become `failed` and later be rewritten as `cancelled`.
5. Every cancelled or completed one-shot projected-Agent session execution publishes exactly one durable terminal `session.status`; a normal resumable chat prompt generation returns to idle rather than terminal. No in-memory-only terminal may seal the first-terminal latch before durable publication.
6. Task and active Run terminal facts commit atomically after all owned execution has settled. A failed cancellation preserves non-terminal Task/Run facts and records; a successful cancellation cannot start a replacement Orchestrator.
7. Existing strict evidence validation, exact terminal replay checks, single Task lifecycle authority, natural Orchestrator decisions, and visible real message flow remain intact.
8. Production-shaped tests cover the combined failure chain, not only isolated schemas, mocked contracts, or direct Browser MCP calls that bypass expert-squad projection.

### Hard constraints

- No host routing gate, retry counter, status machine, severity-to-failure mapping, keyword classifier, hard wall-clock timeout, fallback MCP process, synthetic message, hidden wake, or duplicate lifecycle source.
- Do not relax `completeDispatchOwnershipLifecycle` exact terminal replay. Conflicting outcomes must remain rejected.
- Do not let a Browser sidecar crash transparently create a replacement process while pretending its in-memory session survived.
- Do not accept old Frontend Design images, layout geometry, bare paths, or previous-run screenshots as fresh Visual QA rendered evidence.
- Do not make Task failure automatic merely because one worker reports failure. Orchestrator remains the only Task lifecycle decision-maker.
- Do not restart, stop, refresh, or otherwise interfere with the user's running OpenCorvus or Overlay processes while implementing or verifying the repair.
- Real browser and visual verification must use Node-launched Playwright or the canonical Browser MCP sidecar, never Bun-launched Playwright.
- Every behavior change requires regression coverage and real observable message/session evidence.

### Runtime evidence read

- User-supplied Task debug blob generated at `2026-07-21 00:56:34Z`.
- SQLite database `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- Server log `/Users/yangheng/.local/share/opencorvus/log/2026-07-20T182644-80821-1.log`.
- Exact Task, Run, Goal, session, message, part, protocol-event, coordination, and orchestrator-tool-ownership rows for `tsk_f802684850012OpovnGW0NRPJb`.

### Architecture and historical records read

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-01-browser-preview-native-webview-root-repair.md`
- `specs/records/2026-07/2026-07-06-visual-qa-tool-result-acceptance-contract.md`
- `specs/records/2026-07/2026-07-14-delegated-context-agent-ownership.md`
- `specs/records/2026-07/2026-07-14-mission-delete-settled-queue-reference-integrity.md`
- `specs/records/2026-07/2026-07-15-session-background-execution-ownership.md`
- `specs/records/2026-07/2026-07-16-platform-legacy-debt-cleanup.md`
- `specs/records/2026-07/2026-07-20-build-agent-browser-mcp-projection.md`
- `specs/records/2026-07/2026-07-20-chat-browser-preview-task-binding.md`
- `specs/records/2026-07/2026-07-20-task-research-dispatch-observability-systemic-repair.md`

### Whole-repository grep evidence

- `rg -n "request_orchestrator_decision|createAgentCoordinationRequest|respond_agent_coordination|cancelPendingAgentCoordinationRequest|agent\.coordination\.(requested|cancelled|responded)|dispatchTaskLoop" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "abortLiveOrchestratorToolOwnership|orchestrator_tool_ownership|refusing conflicting cancelled replay|TaskCancellationIncompleteError|cancelTask\(|cancelSessionPrompt|terminateSessionPrompt|publishSessionStatus|SessionStatus\.set" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "BrowserMCPBuiltin|browser_tool_session_create|session_create|Session not found|submit_visual_qa_report|visual QA check graph|screenshot-bearing|createVisualQaEvidenceTools|browser_preview" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx" -g "*.rs"`
- The inventories contain 477 coordination matches, 286 cancellation/session-terminal matches, and 556 Browser/Visual QA matches. The call-point dispositions below name the production owners that change; remaining matches are consumers, schemas, generated contracts, tests, or historical evidence that must be reviewed during implementation.

### Independent Agent feedback

Three first-level Agents audited independently. Each was read-only and explicitly forbidden from further delegation.

| Audit                            | Independent conclusion                                                                                                                                                                                                                                                                                                                                                     | Contribution to the final plan                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordination livelock            | Proved that queued wakes were not lost. A live synchronous `dispatch_agent` ownership prevents its own worker-originated wakes from draining, while the worker cannot exit without an unsatisfied domain finalizer. The latest Visual QA produced 61 requests; an earlier same-shape session produced 427 requests and 775 mailbox messages before `ContextOverflowError`. | Make coordination a typed terminal control handoff returned through the existing synchronous dispatch result, not another queued wake. Add one pending request per execution scope as a data-integrity constraint, not a scheduler gate.     |
| Cancellation and terminal status | Proved the exact `failed -> cancelled` race and the `publish:false` in-memory terminal latch that suppresses every later durable terminal publication. Also found a separate Task/Run terminalization window.                                                                                                                                                              | Introduce typed cancellation, one ownership terminal writer, one awaited session-terminal publisher, and one atomic Task/Run terminal commit. Preserve strict conflicting-replay rejection.                                                  |
| Browser and Visual QA            | Independently confirmed that projected tools execute through different scoped MCP sidecars, so stateful Browser session IDs cannot survive between tool calls. Proved that all three relevant Visual QA sessions had 100% create-to-first-navigate failure through the projected wrapper, while direct same-client Browser tests bypassed the defect.                      | Add a projected MCP session-runtime connection owner, distinguish reviewed outcomes from execution failures, bind screenshots to fresh durable evidence, and add production-shaped cross-tool/browser visual E2E (End-to-End, 端到端) tests. |

No material disagreement remains. The coordination audit recommends that `request_orchestrator_decision` terminate a worker turn that cannot yet form a legal stage result; the Visual QA audit recommends an explicit `execution_failed` stage outcome. They are mutually exclusive completion paths: a verified Visual QA execution failure completes through its stage finalizer and the normal synchronous `dispatch_agent` result, while coordination handoff is reserved for a worker that cannot honestly form any legal stage terminal without an Orchestrator decision.

The later correctness review used three new independent read-only Agents: architecture/single-source, concurrency/lifecycle, and implementation/test coverage. All three rejected the pre-review plan as not yet implementable; their confirmed blockers and resolutions are recorded in `Codex review feedback`. No Agent reviewed an implementation diff because `HEAD 5fbe82f6d` contained only this proposed plan.

### Implementation progress

- Projected MCP session-runtime ownership was implemented and pushed in `358d64cc9`; projected stateful cross-tool tests use one session-owned connection.
- Typed persisted MCP error results were implemented and pushed in `1a4e82604`.
- The strict Visual QA `reviewed | execution_failed` outcome was implemented and pushed in `38ec94d3d` with current attempt/owner/tool-call verification and no fabricated acceptance.
- Terminal coordination handoff was implemented in `51b7b952b`: the worker persists one ownership-bound request, returns strict `handoff_drain` tool metadata, drains already-started sibling calls, rejects later calls, bypasses only the declared domain finalizer, and synchronously yields the request through the existing `dispatch_agent` result. It no longer calls `dispatchTaskLoop` from the worker.
- The canonical `engine_artifact` request row now has a partial unique index for one pending `worker_handoff` per dispatch ownership. SQLite constraint conflicts are translated into a typed ownership conflict after the database rejects the write; there is no application pre-scan gate.
- Typed prompt/dispatch cancellation now propagates as `ExecutionCancellationError`. `dispatch_agent` releases its invocation stack without writing a failed or cancelled ownership; the authoritative ownership cancellation pass writes the sole cancelled terminal fact. Genuine provider/tool failures still write failed.
- Low-level prompt cancellation no longer writes any in-memory terminal status. It retains the exact generation owner and finish receipt; the high-level cancellation scope waits for physical finish, then awaits canonical session-project publication of one durable `terminal aborted` event. SessionLoop and the projected-Agent runner suppress their competing terminal publishers for the typed cancellation.
- `terminalTask` now writes the Task terminal facts and its active Run terminal artifact in one database transaction with one ordered post-commit publication effect. A malformed active Run rolls the Task write back; an already-terminal Task with a still-live Run is a data-integrity error instead of an out-of-band repair. `cancelTask` no longer writes the Run early.
- Cancellation no longer wraps ownership cleanup, live-execution cleanup, or queue prompt settlement in fixed wall-clock deadlines. Queue settlement now observes the canonical in-flight owners plus Session activity and renews an inactivity window whenever execution makes progress; Project deletion and Task/session deletion use the same queue settlement primitive. Misleading `abortTimeoutMs` / `cleanupTimeoutMs` cancellation options and constants were replaced by explicit prompt/queue inactivity names.
- `requestTaskAgentLifecycleCancellation` now only requests physical prompt cancellation and returns the captured handles. It no longer terminalizes pending coordination before physical settlement; Task/session deletion and Task cancellation cancel those requests only after prompt settlement succeeds.
- Session Part persistence now exposes a synchronous caller-transaction writer that reuses the existing validation, tool-status monotonicity, and post-commit publication implementation. A rollback regression proves a cancelled owned tool part cannot escape a failed composite terminal transaction.
- Dispatch ownership completion and pending coordination cancellation now expose synchronous transaction primitives reused by their existing public wrappers. Exact ownership replay/conflict semantics and linked-action updates remain in `agent-coordination.ts`; the future composite writer will not duplicate their SQL.
- The state layer now exposes its existing terminal decision-log refresh as a reusable post-commit operation. The composite cancellation writer must invoke it only after the authoritative transaction succeeds and the committed lifecycle counts have been recorded.
- Remaining work after this cancellation slice: extending the atomic cancellation transaction across ownership/coordination/Goal Run/owned tool parts, full lifecycle caller convergence, Orchestrator evidence projection, and the combined production-shaped regression chain.

## Incident reconstruction

### 1. Stateful Browser MCP was split by tool

`PromptProfileResolver.defaultMcpToolFromConfig()` passes each projected tool's unique `providerName` to `MCP.scopedTool()`. Tool execution later calls `MCP.callScopedTool()`. Outside `MCP.withScopedConnectionPool()`, `withScopedClient()` creates a local MCP client/stdio process for one call and closes it in `finally`.

The only current `withScopedConnectionPool()` caller wraps prompt/resource rendering, not model tool execution. Even if tool materialization happens under that pool, the pool closes before the returned tools execute.

Browser sessions live in the Browser MCP process-local `sessions` Map. Therefore:

```text
session_create providerName -> sidecar A -> sessions.set(sessionID) -> sidecar A closes
navigate providerName       -> sidecar B -> sessions.get(sessionID) is absent
```

This deterministically explains every `Session not found` without blaming Browser navigation, the preview target, the page, or the model.

Observed counts:

| Visual QA session              | create calls | navigate calls | first-navigation `Session not found` |
| ------------------------------ | -----------: | -------------: | -----------------------------------: |
| Initial reviewer               |            3 |              3 |                                    3 |
| Long retry reviewer            |           16 |             12 |                                   12 |
| Final reviewer `ses_07df98...` |           13 |             12 |                                   12 |

The existing `browser-stdio` E2E keeps one Client/transport alive and therefore passes. Resolver tests assert projection, permission, and individual calls but never perform a stateful sequence through the returned projected tools.

### 2. Visual QA could neither review nor honestly terminate

The current Visual QA report validator applies the multi-viewport screenshot-bearing check to every report, including `accepted=false`. When Browser execution itself fails before capture, the worker cannot produce those screenshots. Its four `submit_visual_qa_report` calls were rejected and `collector.final` remained false, so the shared runner could not finish.

Earlier non-pass evidence also exposed the inverse integrity problem: old Frontend Design image refs could satisfy the structural screenshot-bearing check even when notes admitted they were not fresh review evidence. The contract therefore blocks an honest infrastructure failure while accepting a stale image shape.

### 3. Coordination formed a self-owned queue livelock

`request_orchestrator_decision` persists a request and calls `dispatchTaskLoop`. Normal coordination wakes are queued behind live tool ownership. `dispatch_agent` synchronously awaits the worker and terminalizes ownership only after the worker returns. The worker was told to end through its required finalizer, but that finalizer was impossible to satisfy.

The result was not a missing wake:

```text
worker needs decision
  -> persists request and queues wake
  -> wake waits for live dispatch ownership to drain
  -> dispatch ownership waits for worker to finish
  -> worker cannot finish its evidence finalizer
  -> worker opens another message and creates another request
```

Deduplication covers only replay of the same session/message/call. Every new assistant message created a different valid request. The final reviewer created 61 requests; the earlier reviewer created 427. Existing tests separately prove same-message replay and post-ownership drain, but not this combined production chain.

### 4. Cancellation wrote two outcomes for one ownership

At `00:53:04.849Z`, Task cancel first called `requestTaskAgentLifecycleCancellation`, which aborted the worker prompt and rejected its callback with an ordinary `Error("session cancelled")`. `dispatch-agent-tool` classifies every caught exception as `failed`, so it wrote ownership `art_f820670...` terminal `failed` at `00:53:05.225Z`.

The same cancel call still held its pre-abort live ownership snapshot. `abortLiveOrchestratorToolOwnership` then attempted terminal `cancelled`. The strict writer correctly rejected the conflicting replay, and the route returned HTTP 409 `TaskCancellationIncompleteError`.

The strict writer is not the bug. The two competing terminal writers and untyped cancellation error are the bug.

### 5. In-memory cancellation suppressed durable terminal status

Directory-scoped `SessionPromptState.cancel()` defaults to `publish:false` but still calls `SessionStatus.set(terminal aborted)`. That seals the process-local first-terminal latch. The later runner/actor publisher sees an existing terminal and silently drops its durable publication.

The database consequently has zero terminal status events for three genuinely ended sessions:

| Session                          | Durable status events | Durable terminal events | Last durable status | Message terminal evidence |
| -------------------------------- | --------------------: | ----------------------: | ------------------- | ------------------------- |
| Visual QA `ses_07df98...`        |                   332 |                       0 | streaming           | `MessageAbortedError`     |
| Frontend Design `ses_07fb51...`  |                   172 |                       0 | streaming           | `MessageAbortedError`     |
| Old Orchestrator `ses_07fd97...` |                    82 |                       0 | streaming           | `MessageAbortedError`     |

The Agent Invocation DAG (Directed Acyclic Graph, 有向无环图) is faithfully projecting broken producer facts; this is not an Overlay status bug.

### 6. Failed cancel allowed queued work to complete the Task

Because cancellation returned 409 without terminalizing the Task, the coordination backlog remained eligible. A replacement Orchestrator started at `00:53:05Z`, read six passed Goals and existing evidence, and called `complete_task` at `00:53:43Z`. Task and Run became completed while three historical sessions still projected streaming.

This does not justify a host completion gate. It proves that the Orchestrator prompt/context must treat pending coordination, live dispatch ownership, and current stage-attempt outcomes as first-class evidence before making a lifecycle decision.

## Systemic repair design

### A. Projected MCP session-runtime owner

Create one runtime owner for a projected MCP server connection. Its identity is derived from durable runtime facts, not from a tool name:

```text
project + task/session runtime identity + projected Agent identity
+ canonical MCP server ref + resolved config digest + execution directory
```

- All tools from one default or package MCP server in the same Agent session bind to that owner.
- `session_create`, `navigate`, `observe`, `screenshot`, diagnostics, and destroy call the same MCP Client and sidecar.
- Different Agent sessions always receive isolated owners, including when profiles are intentionally reused.
- Build the immutable session/projection identity and worker descriptor locally without publishing either to `SessionRuntimeContractStore`.
- Create one not-yet-installed `SessionRuntimeResourceScope`, use it to materialize every projected tool, then atomically transfer `{ completeContract, resourceScope }` into one async Store installation. The complete contract still contains the validated frozen `projectedTools`/`stageTools`; there is no half-installed contract or second projection identity.
- Materialization or installation failure awaits disposal of the still-local scope. Once installed, contract replacement, session terminal, abort, and clear close admission to new operation leases, await existing leases, then dispose the scope exactly once.
- Migrate every production and test caller of `SessionRuntimeContractStore.clear`, `SessionPrompt`/`SessionLoop.setSessionRuntimeContract`, and `clearSessionRuntimeContract` to awaited installation/disposal. Lease settlement uses activity evidence rather than a wall-clock deadline.
- A continuation of the same protocol finalizer session preserves the same owner while that runtime contract remains valid.
- Sidecar exit or transport loss terminalizes the owner with a visible error. It does not transparently reconnect because a new process cannot contain the old state.
- Default and package MCP projections use the same owner abstraction. Provider names remain tool identities only; they no longer determine server process identity.
- The resource scope consumes only the active projection already resolved by `PromptProfileResolver`; it does not scan package roots, catalogs, or inactive capabilities and cannot select an expert squad.
- Retire per-call local stateful MCP creation from projected tool execution. Keep bounded scoped connections only for stateless catalog/preview inspection where no capability returns a cross-call handle.

Primary call-point disposition:

| Call point                                                                                                                                                             | Disposition                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp/index.ts::withScopedClient`                                                                                                                                       | Preserve for bounded inspection; remove it as the execution lifetime of projected stateful tools.                                                  |
| `mcp/index.ts::withScopedConnectionPool`                                                                                                                               | Preserve prompt/resource batching; do not pretend its AsyncLocal scope owns later model tool calls.                                                |
| `prompt-profile-resolver.ts::defaultMcpToolFromConfig`                                                                                                                 | Bind tools to the server/session runtime owner, not `providerName`-scoped clients.                                                                 |
| `prompt-profile-resolver.ts::packageMcpToolFromDefinition`                                                                                                             | Use the same server owner keyed by canonical package MCP declaration identity/config digest.                                                       |
| `session/runtime-contract.ts`, `SessionRuntimeContractStore.clear`, `SessionPrompt`/`SessionLoop.setSessionRuntimeContract`, and `clearSessionRuntimeContract` callers | Atomically install the already-complete contract with its locally prepared resource scope and own awaited continuation, replacement, and disposal. |
| `mcp/browser/sessions.ts`                                                                                                                                              | Preserve process-local Browser session truth; do not add a cross-process session fallback.                                                         |

### B. Strict Visual QA outcome union

Replace the ambiguous final payload with a strict discriminated union:

1. `outcome="reviewed"`
   - Carries the existing Visual QA verdict, including accepted true or false.
   - Both pass and product-defect non-pass require fresh current-attempt rendered screenshots for every claimed viewport/region plus the existing interaction, focus, diagnostics, and provenance evidence.
   - Old Frontend Design images remain source/reference context only.

2. `outcome="execution_failed"`
   - States that this Visual QA attempt could not execute; it is not a visual verdict and creates no acceptance result.
   - `materializeMcpToolResult` projects top-level `CallToolResult.isError` into one typed persistent metadata field. Default and package projected MCP wrappers preserve that same field when writing tool results; they do not each invent a status representation.
   - The tool verifies current-session call IDs, target, projected MCP owner, time/attempt binding, and the persisted structured MCP error field or thrown error. It treats `isError=true` as failure even when the enclosing tool part is stored as completed; it never infers failure only from part status or error text.
   - It persists a typed stage-attempt outcome, production blocker, and `failure_fingerprint` derived from server config digest, projection hash, tool identity, and direct structured error. Titles and error-string keywords are not identity.
   - It satisfies the Visual QA terminal collector and returns through the normal synchronous `dispatch_agent` result. It must not create a coordination request for the same failure.

This keeps the evidence contract strict while making infrastructure failure representable. Geometry-only output, stale screenshots, cross-task evidence, or a bare `Session not found` string cannot produce a reviewed result.

### C. Terminal coordination handoff

Make `request_orchestrator_decision` an explicit terminal completion alternative in the core dispatch-adapter contract, carried by the existing visible tool-result path rather than a hidden alternate engine.

- Persist the visible request exactly as today.
- Extend `DispatchAdapterCompletion` and `WorkerTurnDescriptor` with the typed `coordination_handoff` alternative. The runner may bypass its domain finalizer only when that declared completion contract, the durable pending request, and the real tool-result metadata carry the same request and ownership identity.
- Extend tool-result control to a strict `immediate_park | handoff_drain` union. Existing immediate park semantics remain unchanged; handoff drain records the request, prevents another model step, and continues the current stream instead of triggering `ProcessorLostPartsError`.
- The drain path waits for every already-started sibling execution and consumes its real result/error event until every observed tool part is terminal. Handoff alone does not cancel sibling work; only an existing explicit execution cancellation signal may do so and must persist a real cancelled result. Reject unexpected post-handoff tool starts as a processor contract failure and do not fabricate results for calls that never started.
- Return a typed `coordination_handoff` from the worker runner without requiring its domain finalizer. Record dispatch ownership as `completed`, because the declared control transfer completed normally. Domain `execution_failed` is a separate, mutually exclusive stage-finalizer path.
- Handoff ends only the current prompt generation and `dispatch_agent` ownership. The resumable worker Session returns to durable/observable idle and does not publish terminal; `respond_agent_coordination continue_worker` may start a new streaming generation in that same Session. Domain finalizer completion, unrecoverable error, or authoritative cancellation remains the terminal Session boundary.
- Return the request ID and current stage outcome as the real synchronous `dispatch_agent` tool result to the already-owning Orchestrator.
- The same Orchestrator turn then calls `respond_agent_coordination` to continue, cancel, redispatch, ask the operator, or make a Task lifecycle decision.
- Do not call `dispatchTaskLoop` for a request emitted by a worker currently synchronously owned by that Orchestrator. External/operator coordination ingress retains its explicit wake behavior.
- Give a synchronous worker handoff the normalized identity `tool_ownership_id` and persist non-optional `origin=worker_handoff`: one `dispatch_agent` ownership can have at most one pending worker-handoff request. Operator steer has a different origin and identity. Enforce this directly on the canonical `engine_artifact` request rows with a pending worker-handoff partial expression unique index over Task and payload ownership identity; do not add a current-request table, duplicate column truth, or pre-insert application scan. Request terminalization updates the canonical row and releases the same unique slot.
- Non-blocking narrative/status remains `send_mailbox_message` and cannot claim a coordination handoff.
- Bind crash recovery to the existing `server_restart_active_task_recovered` ingress. If the process exits after ownership completed but before the parent `dispatch_agent` tool result persisted, recovery wakes the existing Task from the same durable pending request and settled ownership; it does not recreate the request, ownership, worker, or a hidden handoff message. Because the old runtime contract and MCP sidecar are process-local, recovery may decide cancel, redispatch, fail, or ask the user, but cannot claim same-session continue until a new explicit recoverable runtime contract exists.

Do not implement any of these rejected alternatives:

- Let coordination wakes bypass live ownership.
- Add a retry count, request count, hard timeout, or severity-based auto-failure.
- Deduplicate only by error text or title.
- Loosen the Visual QA finalizer so missing screenshots become a visual non-pass.
- Add a Visual-QA-only scheduler special case.

### D. Single cancellation and session-terminal authority

#### Typed cancellation

- Introduce a structured prompt cancellation result/error owned by the cancellation scope.
- `dispatch_agent` distinguishes typed cancellation from genuine provider/tool failure without keyword matching.
- `dispatch_agent.completeInvocation` receiving typed cancellation writes no ownership terminal at all; it releases only the invocation stack. The ownership remains live for the authoritative cancellation cleanup. Every production entry point that can emit typed cancellation must own and await the matching ownership cleanup, otherwise cancellation is incomplete.
- One cancellation receipt owns one normalized cancellation reason used by prompt, ownership, action, Goal Run, Run, and Task settlement. Adapter and cleanup cannot invent different error strings for the same cancellation.

#### Ownership terminalization

- `abortLiveOrchestratorToolOwnership` remains the cancellation authority and delegates its final durable write to the transaction described in section E.
- Before acting on each originally observed ownership, reread its latest durable row.
  - Still live: physically settle the child and stage exact `cancelled` for the final transaction.
  - Already naturally completed/failed: preserve that actual terminal fact and do not overwrite it.
  - Already identically cancelled: exact idempotent replay.
- Typed adapter unwind performs no competing terminal write whether it arrives before or after the durable cancelled receipt; genuine natural completion/failure remains subject to the latest-row reread above.
- Keep `completeDispatchOwnershipLifecycle` strict: only identical outcome plus normalized error is idempotent.

#### Session terminal publication

- Low-level `SessionPromptState.cancel` only requests abort of the physical prompt, rejects callbacks with the typed cancellation, and retains the generation owner until finish. It writes no `SessionStatus`.
- Delete its `publishStatus` branch and every in-memory-only terminal write.
- Propagate the typed cancellation through `SessionLoop` and Agent runner. Their catch/finally paths publish no terminal status for this type and instead return the exact generation settlement evidence to the high-level cancellation owner; natural completed/error paths retain their existing publisher.
- The high-level directory-scoped cancellation primitive requests abort and then awaits `SessionPromptState.waitForFinish` for that exact generation owner. Only after the real handle is released does it enter the session's project identity, publish and await exactly one durable `terminal aborted`, and return a cancellation receipt.
- If physical settlement fails, do not publish aborted. Preserve the real aborted-message evidence, live handle, and cancellation-incomplete result for diagnosis.
- Natural completion/error and actor closure observe the same first-terminal fact. They never form a second source.
- Coordination handoff is not natural domain completion: its runner path returns the Session to idle without publishing terminal. Only a completed domain finalizer, unrecoverable execution error, or authoritative cancellation terminalizes a projected worker Session.
- Migrate and await all production callers in Agent runner, cancellation scope, execution abort, task-agent lifecycle, Orchestrator, project deletion, queue service, Coding/Mission/session routes, and `delegate_agent`.
- Remove `CANCEL_ABORT_TIMEOUT_MS`, `CANCEL_CLEANUP_TIMEOUT_MS`, and their `withTimeout` wrappers from this cancellation chain. Settlement failure is determined by activity-aware ownership evidence and explicit external abort, not a fixed 5-second or 60-second wall clock.

### E. Atomic ownership cancellation and Task/Run terminal commits

- Remove the early active-Run `aborted` update from `cancelTask`.
- Finish every potentially failing physical prompt, queue, worker, and session settlement first; retain still-live ownership, linked coordination, Goal Run, owned tool part, Task, and Run facts for the final transaction. Physical settlement failure must not pre-terminalize a Goal Run or trigger terminal-goal refill.
- Extract one pure primitive that accepts an existing database transaction and performs strict ownership terminal replay plus its linked coordination update without notification. Reuse it from ordinary completion and Task cancellation; do not add a `notify=false` fork around a second writer.
- After every physical settlement succeeds, one transaction writes all scheduler-visible cancellation facts: owned tool parts, still-live ownerships, linked coordination actions, affected Goal Runs, Task cancelled, and active Run aborted. Normal completed/failed Task outcomes use the same transaction boundary for Task and active Run.
- Persist ordered protocol facts in that transaction, then register one ordered post-commit effect that awaits their publication and invokes `notifyToolOwnershipCompleted` last. Do not register independent `Database.effect` callbacks whose concurrent execution would make ordering accidental.
- Any queued-wake or terminal-goal drain therefore observes the complete terminal Task/Run/ownership/coordination/Goal Run projection and records a visible terminal-task ignored result instead of creating a replacement Orchestrator.
- For normal completed and failed Task outcomes, `terminalTask` also writes Task and active Run terminal facts in one transaction and publishes both only from the committed result; cancellation extends that same terminal transaction with its ownership and coordination facts.
- If physical settlement fails, neither Task nor Run becomes terminal; `TaskCancellationIncompleteError` preserves all records and exact partial terminal session facts for later diagnosis.
- Repeated cancel is exact: already-cancelled with consistent Task/Run facts is idempotent success; already completed/failed preserves that terminal outcome rather than claiming cancellation success; cancelled with inconsistent Run facts is a data-integrity error, not a silent repair. It must never dispatch or create a replacement Orchestrator.

### F. Orchestrator evidence consumption

- Project current pending coordination requests, live ownerships, and current stage-attempt outcomes into the natural Orchestrator decision context.
- Project these facts through the existing core Orchestrator lifecycle context for every active expert squad; previously passed Goals do not erase a newer execution failure. Package overlays remain package-owned guidance and never scan inactive packages.
- Persist the Visual QA `failure_fingerprint` as evidence so the Orchestrator can recognize an unchanged infrastructure failure and avoid blind redispatch through the same projection. Code/config/projection/target changes produce a different fingerprint and allow a responsible new attempt.
- This is scheduler evidence, not a host retry gate. Orchestrator still decides whether to repair, redispatch, fail, cancel, or complete.

## Codex review feedback

The first independent second review found six blockers and led to the initial convergence of physical prompt settlement, typed cancellation, ownership authority, Task/Run atomicity, handoff identity, parallel tool settlement, and MCP disposal.

A later user-requested correctness and architecture review independently re-read the landed plan against current code. It rejected the then-current plan and found additional blockers that this revision explicitly closes:

1. A complete runtime contract cannot be installed before its projected tools exist. The corrected design prepares an invisible local resource scope, materializes tools, and atomically installs the complete validated contract plus scope once.
2. Tool-result park metadata alone cannot bypass the runner finalizer. Coordination handoff is now a declared `DispatchAdapterCompletion`/`WorkerTurnDescriptor` alternative verified against the durable request and visible tool result.
3. `execution_failed` and coordination handoff cannot represent the same Visual QA failure. They are mutually exclusive: the former is a legal stage terminal; the latter is only for the absence of any legal stage terminal.
4. Current processor park behavior closes the iterator and converts sibling parts into `ProcessorLostPartsError`. The design now requires explicit handoff-drain semantics and complete sibling tool-part settlement.
5. Cancellation atomicity must include owned tool parts and Goal Runs, not only ownership, coordination, Task, and Run. One transaction and one ordered post-commit effect now cover every scheduler-visible fact before notification.
6. Typed cancellation must suppress the existing `SessionLoop` and Agent-runner terminal publishers until the exact prompt generation physically finishes.
7. Worker-handoff uniqueness stays on canonical `engine_artifact` rows; a dedicated current table would be a second source.
8. Fixed cancellation deadlines are replaced with activity-aware settlement, core lifecycle context carries evidence without editing package overlays, and restart recovery binds to the real `server_restart_active_task_recovered` ingress.
9. Prompt-generation finish and session terminal are distinct: only cancelled/completed one-shot projected execution publishes terminal; resumable chat returns idle.
10. Visual QA execution-failure verification reads structured MCP `isError` results as well as thrown failures, rather than assuming every failed MCP call creates an error-status tool part.
11. Handoff settles only the current prompt generation and dispatch ownership. The worker Session stays idle/resumable until domain completion, unrecoverable error, or cancellation; no first-terminal latch is sealed at handoff.
12. Projected MCP wrappers persist top-level `isError` through materialization so a later finalizer/restart reads the same typed fact rather than relying on the raw in-memory result.
13. The implementation audit found that Task cancellation must interrupt and await the full Task loop, not only the current Orchestrator run; the old pipeline registry has no production setter and is not settlement evidence. The final transaction must also discard queued operator wakes before ownership completion notification, or a wake can reopen the just-cancelled Task.
14. The final transaction must read all open ownership, not only current-process ownership. A live foreign owner is incomplete physical settlement; an orphaned foreign owner can be terminalized only through shared owner-liveness evidence. New ownership or Goal Runs admitted after the physical snapshot must make the composite transaction roll back.

Non-blocking guidance remains accepted: `execution_failed` cannot carry acceptance/verdict fields; fingerprints remain context evidence only; successful handoff completes dispatch ownership; repeated cancellation distinguishes existing completed/failed outcomes and inconsistent Task/Run facts; MCP resource scope never becomes a second active projection source.

One implementation review proposed a dedicated current-claim table for handoff uniqueness. The architecture review rejected that as a second coordination source. Repository evidence resolves the disagreement: `session/session.sql.ts` already uses a partial expression unique index over JSON tool identity, so the canonical `engine_artifact` row can enforce the same invariant directly. Implementation must persist `origin=worker_handoff` and `tool_ownership_id` in that row and use the partial expression index; it must not create a parallel claim ledger.

The final independent architecture pass confirmed that the corrected handoff Session lifecycle and MCP `isError` persistence paths close its last two blockers. The plan is architecture-ready to enter implementation. This is not evidence that an implementation exists or is correct; code-level acceptance remains bounded by the full verification matrix below.

## Implementation order

1. **P0-A — Projected MCP owner**
   - Prepare a local server/session resource scope, bind default/package projected tools through it, then atomically install the complete runtime contract and scope.
   - Migrate every synchronous contract clear/install caller to awaited disposal.
   - Add lifecycle disposal and stateful cross-tool tests.
   - This removes the upstream deterministic Browser failure before judging downstream retry behavior.
2. **P0-B — Visual QA outcome and coordination handoff**
   - Add `reviewed | execution_failed` outcomes.
   - Keep `execution_failed` terminal return mutually exclusive from coordination handoff.
   - Add typed terminal coordination handoff to the dispatch adapter/descriptor completion ABI and extend processor handoff-drain behavior for parallel tool-part settlement.
   - Propagate the new completion union through every registered worker adapter, `AnalyzeResult`, stage dispatcher, and `dispatch_agent` result; do not implement a Visual-QA-only path.
   - Normalize worker handoff identity to `tool_ownership_id` and enforce uniqueness in the database representation.
   - Remove worker-originated queued wake from the synchronous ownership path.
3. **P0-C — Cancellation and terminal convergence**
   - Introduce typed prompt cancellation.
   - Consolidate ownership terminalization and durable session terminal publication.
   - Replace hard cancellation deadlines with activity-aware settlement.
   - Atomically commit owned tool parts, cancellation ownership, linked coordination, Goal Runs, Task, and Run terminal facts before one ordered notification effect.
   - Keep decision-log filesystem refresh after the database transaction; it cannot participate in or invalidate the authoritative terminal commit.
4. **P0-D — Full-chain verification and observability**
   - Run production-shaped real Task chains for success, infrastructure failure, coordination, cancellation, restart, and visual evidence.
   - Verify copied Task debug/DAG projection contains zero false nonterminal sessions after settlement.
5. **Secondary review**
   - Independently review the final diff against this Recall and the three audit conclusions.
   - Keep this `Codex review feedback` section current when later implementation review finds missed callers or contracts.
6. **Spec governance and delivery**
   - Update `specs/README.md`, the monthly record index, and applicable document-health sources with every plan revision.
   - Use the `dsw-33987` commit prefix, run hooks without bypass, and push the main branch to `legacy-remote` before claiming delivery.

## Verification matrix

### Projected MCP runtime

1. Resolve a real frontend-innovate Visual QA worker through `PromptProfileResolver`; execute projected `session_create -> navigate -> viewport_set -> observe -> screenshot -> diagnostics_get -> session_destroy`. Assert one connection owner, first navigation success, and a visually inspectable screenshot.
2. Run two projected workers concurrently. Assert distinct Browser page/session owners and that destroying worker A does not affect worker B.
3. Continue the same worker finalizer session and prove the runtime contract either preserves the owner or explicitly invalidates old handles; never silently swaps processes.
4. Terminal/abort/contract clear closes the child process and makes later calls fail explicitly.
5. Clear the runtime contract while an MCP call is active. Assert clear awaits real call settlement, transport closes exactly once, no owner is deleted early, and no child process remains.
6. Cover default local MCP, package local MCP, and a remote stateful fixture with cross-tool handle continuity.
7. Crash the Browser sidecar after `session_create`; assert no transparent reconnect and one verified `execution_failed` outcome.
8. Fail during tool materialization and during atomic contract installation. Assert no contract/tool surface becomes visible, the local resource scope closes once, and no orphan process remains.

### Visual QA evidence

1. Browser unavailable: current tool failure produces one `execution_failed`, no visual report, no acceptance, no coordination request, one normal synchronous dispatch result, and no fake screenshot.
2. The `execution_failed` schema rejects acceptance, verdict, and reviewed-evidence fields; Task failure remains an Orchestrator decision.
3. Cover both thrown Browser errors and `CallToolResult.isError=true` stored inside a completed tool part. Assert the raw MCP result, `materializeMcpToolResult` output, persisted default/package wrapper metadata, and reloaded tool part retain the same typed error fact bound to the current owner/call/attempt; no path relies on error-string matching.
4. Fresh screenshots with a real product defect: `reviewed accepted=false` succeeds and cites current attempt evidence.
5. Fresh screenshots with passing behavior: required desktop viewports, interaction/focus path, diagnostics, and screenshot provenance pass.
6. Previous-run, Frontend Design, cross-task, geometry-only, string-ref, and stale-target images all fail reviewed-evidence validation.
7. Real Node/Playwright visual review inspects screenshots for every task-scoped delivery region; fixture-only strings are not E2E proof.

### Coordination

1. Shared runner: an unsatisfied domain finalizer plus one decision request declared by the adapter/descriptor ABI returns typed handoff, with no `TerminalToolMissing` and no second model step. Metadata without the declared ABI remains invalid.
2. Parallel/different-message calls in one execution scope produce one pending request by exact database identity.
3. One assistant turn runs a handoff tool and a sibling tool concurrently. Every started part reaches a real terminal result, unstarted calls are not fabricated, and the runner returns only after the turn settles.
4. Synchronous `dispatch_agent`: handoff settles ownership exactly once as completed and returns request ID to the owning Orchestrator in the same turn; zero coordination wakes queue behind that ownership.
5. After handoff, assert the current prompt generation and ownership are settled, the worker Session is idle with no terminal event, and `respond_agent_coordination continue_worker` starts a new streaming generation in the same Session. Domain finalizer completion later publishes exactly one terminal event.
6. A non-Visual-QA worker with no legal stage terminal produces one request, zero repeated mailbox pleas, and a visible Orchestrator response action.
7. Enumerate every registered adapter that exposes `request_orchestrator_decision`; assert its completion contract, descriptor, stage result, dispatcher, and `dispatch_agent` result preserve the same typed handoff identity.
8. Restart after request persistence and ownership completion but before the parent tool result commits. Use two real server processes and one database: process A persists then exits; process B enters through `server_restart_active_task_recovered`, projects the same pending request/transcript, and makes a legal new decision without mocked loop reinstallation, worker/request/ownership recreation, or claimed same-session continuation.
9. Operator-steer/external ingress retains its own tested wake behavior and cannot recreate the live-ownership self-wait.

### Cancellation and terminal status

1. Directory-scoped prompt cancellation publishes exactly one durable terminal aborted event. Runner, loop, and actor closure cannot add a second terminal.
2. Typed cancellation reaches both SessionLoop and Agent runner before physical finish; neither publishes terminal, and only the high-level generation owner publishes aborted after `waitForFinish`.
3. A normal resumable chat turn and a coordination-handoff worker generation both return idle without a terminal event; domain-completed/cancelled/failed projected workers and one-shot Orchestrator wake termination remain separately covered.
4. Barrier test reproduces the original adapter unwind race. Assert no `failed/session cancelled` ownership, one cancelled artifact, linked action/Goal Run consistency, and no HTTP 409.
5. Stale ownership snapshot: worker naturally completes after cancel observes it; cancellation rereads and preserves completed rather than rewriting cancelled.
6. Natural provider/tool failure remains terminal error/failed and is never misclassified as cancellation.
7. Full Task API path with root, Orchestrator, worker, Run, Goal Run, pending coordination, ownership, and owned tool part returns HTTP 200 cancelled; every one-shot execution session is durably terminal; no replacement Orchestrator starts.
8. Queue a worker coordination wake before cancellation. Assert the atomic cancellation commit precedes the single ordered post-commit effect; notification reads complete Task/Run/ownership/coordination/Goal Run/tool-part terminals and creates no replacement Orchestrator.
9. Fail physical settlement before the final transaction. Assert Task, Run, ownership, coordination, Goal Run, and tool part remain at their last truthful facts, no terminal-goal refill starts, records remain, and cancellation returns 409.
10. Prove continuing activity keeps cancellation settlement alive without a fixed deadline, while explicit external abort yields a visible incomplete result.
11. Restart with an empty process-local status map still projects durable aborted/error one-shot sessions as terminal in the DAG.

### Task/Run lifecycle and full regression

1. Completed, failed, and cancelled Task/Run facts are each atomic and event order follows the committed transaction.
2. Previously passed Goals plus a newer pending coordination/execution-failure fact are all visible to the Orchestrator before lifecycle choice.
3. Re-run a production-shaped equivalent of `tsk_f802...`: no create-to-navigate loss, no repeated Visual QA loop, no cancellation conflict, no stale streaming DAG node, and an evidence-justified explicit final Task decision.
4. Verify `task.activity.updated`, invocation DAG status counts, stage outcomes, ownership terminal facts, and copied debug info against SQLite and protocol events.

## Required verification commands

The implementation must select exact focused files as they are added, then run at least:

- `bun test packages/opencorvus/test/mcp/browser-session-lifecycle.test.ts packages/opencorvus/test/mcp/browser-stdio.test.ts`
- Focused new projected-MCP stateful sequence tests through `PromptProfileResolver`.
- Focused new Visual QA reviewed/execution-failed and coordination-handoff tests.
- Focused Task cancel live-ownership, prompt-terminal persistence, and Task/Run atomicity tests.
- A real two-server-process restart recovery test over one database; mocked runtime reinstallation is not E2E proof.
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck` when debug/DAG projection changes.
- Node-launched real browser/visual scenarios with screenshot inspection.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`
- Mandatory pre-push hooks without `--no-verify`.

## Completion boundary

This plan is not complete when unit tests merely prove new schemas or mocked outcomes. Completion requires the real projected MCP cross-tool sequence, real worker/Orchestrator handoff, real cancellation race, durable terminal projection, Task/Run atomicity, and screenshot-backed visual review to pass together. If any critical chain remains unverified, delivery must be marked not accepted under rule 28b rather than described as mostly complete.
