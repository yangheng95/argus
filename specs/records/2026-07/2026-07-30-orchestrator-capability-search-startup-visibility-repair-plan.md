# Orchestrator capability-search materialization and startup-failure visibility repair plan

Status: implementation complete; automated verification passing; controlled-failure Desktop visual acceptance passing; healthy live-model visual acceptance unavailable in the isolated no-credential profile

## Recall

### User request

- Investigate why a Task created by an Agent renders no conversation messages.
- Determine the full impact surface and depth instead of treating the empty
  Overlay state or the final `Active` label as the root cause.
- Produce a concrete root-cause repair plan.

### Acceptance criteria

1. The active Expert Squad scheduler projection and the concrete Orchestrator
   Tool table have an exact positive closure: every projected built-in Tool is
   materially executable before the first prompt.
2. `capability_search` retains one semantic implementation and is available to
   Task schedulers through the existing AI SDK adapter path, not through a
   copied search implementation or a projection fallback.
3. A failure before the first persisted prompt message cannot leave a Task as
   `active` with an empty root/Orchestrator transcript.
4. Pre-message scheduler startup failures persist exact infrastructure
   evidence, close the real Orchestrator Session with an error lifecycle fact,
   and terminalize the Task as failed so Retry/Replan is available.
5. Provider or processor failures after a real prompt message exists remain a
   separate stream-error contract; this repair does not reclassify every
   transient in-prompt failure as a startup failure.
6. The Task conversation remains a projection of real messages, Session
   lifecycle facts, Task facts, and protocol events. No synthetic assistant
   message, hidden message, UI-only error message, fallback status source, or
   timer is introduced.
7. Focused non-UI tests exercise the real scheduler construction, first-turn
   message flow, failure lifecycle, and conversation hydration contracts.
8. The repaired packaged application is opened through the real UI and the
   target conversation region is manually reviewed: a healthy Task shows its
   first real turn, while an injected startup failure shows a terminal error
   Session card and failed Task status instead of the empty Active panel.

### Hard constraints

- Preserve `PromptProfileResolver` as the scheduler capability authority,
  `CapabilitySearchTool` as the search semantic authority,
  `createOrchestratorTools` as the scheduler-owned Tool-map builder,
  `SessionStatus` as Session lifecycle authority, and `terminalTask` as Task
  terminal lifecycle authority.
- Reuse `createAiSdkToolFromInfo` for the Tool transport boundary; do not
  hand-copy `CapabilitySearchTool.execute`.
- Do not weaken `projectOrchestratorTools` missing-provider rejection. That
  rejection correctly exposed the broken materialization closure.
- Do not remove `capability_search` from the Orchestrator projection to make
  startup pass. The architecture requires it for every production Agent.
- Do not add a host routing gate, retry state machine, error-name/substring
  classifier, compatibility alias, fallback Tool source, or second Task status
  source.
- Do not render `task.updated.summary` as a fabricated conversation message.
- Do not modify or run UI automated tests. Delete the already-discovered
  `packages/overlay/test/chat-empty-single-source.test.ts` source-assertion test
  when implementation touches this empty-state surface; it is prohibited UI
  automation and has no valid replacement.
- Do not restart, refresh, stop, or mutate the currently running Desktop
  process or its database during diagnosis.
- Preserve all parallel worktree and staged-index changes.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/17-code-work-agent-platform.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-29-capability-harness-foundation-implementation.md`
- `specs/records/2026-07/2026-07-27-desktop-started-task-recovery-scope-repair.md`
- `specs/records/2026-06/2026-06-24-active-task-restart-message.md`
- `packages/opencorvus/src/agent/{tool-pool-data,tool-pool-contract}.ts`
- `packages/opencorvus/src/tool/{capability-search,global-tools,registry,tool,ai-sdk-adapter,tool-id-catalog}.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/orchestrator/{agent,loop,tools,error-envelope,infrastructure-observation}.ts`
- `packages/opencorvus/src/engine/{state,task-status,persist,queue,store,model}.ts`
- `packages/opencorvus/src/session/{loop,status,status-publication,runtime-contract}.ts`
- `packages/opencorvus/src/server/routes/orchestrator.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/overlay/src/services/{conversation,tree-writer,event-policy}.ts`
- `packages/overlay/src/components/{Conversation,TaskStatusHeader}.tsx`
- focused capability, scheduler projection, startup error, Session lifecycle,
  Task conversation route, and AI SDK adapter tests under
  `packages/opencorvus/test/**`.

### Whole-repository search evidence

Repository-wide searches covered:

```text
capability_search / CapabilitySearchTool /
PLATFORM_CAPABILITY_DISCOVERY_TOOL_IDS
createOrchestratorTools / projectOrchestratorTools /
resolveSchedulerCapability / resolveSchedulerTurnProjection
builtInGlobalTools / ToolRegistry / projectedRegistryToolIDs /
createAiSdkToolFromInfo
SessionPrompt.prompt / SessionPrompt.loop / promptInFlight /
recordOrchestratorSessionErrorEnvelope
updateTask(error) / terminalTask / deriveTaskStatus /
recordTaskInfrastructureError
task conversation routes / task.updated / session.status /
selectedConversationHasVisibleItems / currentFailure
```

#### Call-site disposition

| Owner or caller | Complete disposition |
| --- | --- |
| `tool/tool-id-catalog.ts` | Keep `PLATFORM_CAPABILITY_DISCOVERY_TOOL_IDS = ["capability_search"]`; it is the shared production discovery Tool ID source. |
| `agent/tool-pool-data.ts` | Keep search in Chat, Work, Mission, Orchestrator, and every production worker template. It currently adds search to both the Orchestrator role and scheduler base projection. |
| `tool/capability-search.ts` | Keep the Tool definition and catalog execution semantics as the single implementation. Add only an Orchestrator AI SDK transport constructor backed by the shared adapter/definition. |
| `tool/global-tools.ts`, `tool/registry.ts` | Preserve registry loading/materialization for Chat, Work, Mission, and projected workers. These consumers already materialize `CapabilitySearchTool`. |
| `session/loop.ts` | Preserve normal registry materialization for native and worker sessions. Projected schedulers intentionally use exact `runtimeContract.projectedTools`, so their Tool must be present in the Orchestrator map before the loop starts. |
| `prompt-profile-resolver.ts::expandedSchedulerBuiltInToolIDs` | Preserve inheritance and strict projectability checks. It correctly adds `capability_search` to every scheduler with `inherit_base_tools=true`. |
| `prompt-profile-resolver.ts::projectOrchestratorTools` | Preserve exact rejection when a projected Tool is absent from the concrete map. Add a positive full-closure regression rather than weakening this check. |
| `orchestrator/tools.ts::createOrchestratorTools` | Add the missing concrete `capability_search` AI SDK Tool using the semantic Tool definition and existing adapter. Do not create a second search algorithm. |
| `orchestrator/agent.ts` | Production owner of the only `createOrchestratorTools` call. Reorder durable Orchestrator Session creation before failure-prone scheduler setup and split startup failure settlement from in-prompt failure handling. |
| 14 test files calling `createOrchestratorTools` | Preserve their direct scheduler-Tool fixtures. Add closure coverage in `scheduler-capability-projection.test.ts`; no mass async factory conversion is necessary if the transport constructor stays synchronous and initializes on execution. |
| `engine/state.ts::terminalTask` | Use this canonical terminal writer for unrecoverable pre-message scheduler startup failure. Ordinary `updateTask({error})` must no longer own that path. |
| `engine/persist.ts::recordTaskInfrastructureError` | Persist scheduler-startup component, operation, exact error name/reason, and Orchestrator Session identity. Do not mislabel a pre-prompt Tool projection failure as an LLM stream error. |
| `session/status-publication.ts`, `orchestrator/protocol/message-bridge.ts` | Publish the real Orchestrator Session terminal error through the canonical enriched lifecycle bridge so task protocol history and Overlay cards receive channel, agent, lineage, and status facts together. |
| `workbench/board.ts` | Continue exposing `task.error` and `overview.currentFailure`. Do not turn the board summary into a message. |
| `server/routes/orchestrator.ts` | Preserve hydration of real transcript plus protocol events. Add route-level positive assertions that startup failure produces failed Task and terminal-error Session facts even with no message row. |
| `overlay/services/tree-writer.ts` | Materialize a deterministic lifecycle-only card for a Session that terminally fails before its first message. `task.updated` continues to rebuild facts without inventing a message. |
| `overlay/services/conversation.ts`, `Conversation.tsx` | Preserve message/Session-card visibility logic. No product UI change is required if the backend emits the missing real Session terminal fact; verify this manually in the real page. |

`createOrchestratorTools` has one production call and 142 direct calls across
14 test files. Converting the entire factory to async only to initialize one
registry Tool would create broad mechanical churn. The existing synchronous
AI SDK Tool-constructor pattern and `createAiSdkToolFromInfo` adapter allow the
missing Tool to be added without changing those 143 callers or duplicating
search semantics.

### Independent agent feedback

No independent Agent was requested. Current collaboration instructions
prohibit implicit delegation, so the primary Agent owns the investigation and
second review.

## Current live and executable evidence

The running Desktop database was inspected read-only at
`/Users/yangheng/.local/share/opencorvus/opencorvus.db`.

| Fact | Evidence |
| --- | --- |
| Affected Task | `tsk_faee2bbdb001YLyuIFQTE0Unvs`, titled `Phase 01: Build personal accounting web app`. |
| Root Session | `ses_0511d4422fferA1PgmGZwuEFFT`, zero messages and zero parts. |
| Orchestrator Session | `ses_0511d3f8cffe74cGwsd0AitIgg`, zero messages and zero parts. |
| Direct failure | `Active expert squad "general" projects Orchestrator tool "capability_search", but createOrchestratorTools did not build that tool.` |
| Task facts | `time_started` is populated, `time_completed` is null, and `error` contains the structured Orchestrator envelope. |
| Protocol facts | `task.created(active)`, `task.updated(active)`, then `task.updated(active, Orchestrator failed...)`; no message or Session terminal event follows. |
| Current database count | One Task contains this exact error; it remains active. This is observed incidence, not the maximum code-level scope. |

The existing non-UI production-path test reproduces the same failure:

```text
bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts \
  -t "general wake installs role-base tools plus its explicit provisioning projection"

0 pass, 1 fail
Received: undefined at expect(captured).toBeDefined()
```

`captured` is assigned only inside `SessionPrompt.prompt/loop`, so `undefined`
proves that the real scheduler failed before the prompt boundary.

## Impact surface

### Expert Squad scope

`expandedSchedulerBuiltInToolIDs` adds the scheduler base Tool set only when
`inherit_base_tools=true`.

| Package | Scheduler inheritance | Exact impact |
| --- | --- | --- |
| built-in `general` | `true` | Broken on every new scheduler wake before its first prompt. This is the observed production case. |
| `frontend-innovate` | `true` | Same missing `capability_search` materialization failure. |
| `frontend-replica` | `true` | Same failure. |
| `research-studio` | `true` | Same failure. |
| `review-debug` | `true` | Same failure. |
| `mirror/prism` | `true` | Same failure. |
| `mirror-watch` | `true` | Same failure. |
| `opentest` | `false` and does not explicitly list search | Not affected by this exact missing Tool, although it currently violates the architecture statement that every production Agent receives search and needs a separate manifest decision during repair review. |
| portable template artifact | `false` and does not list search | Reference artifact is not a running production package; update only if the architecture requires newly generated schedulers to explicitly include search. |

The code-level blast radius is therefore all Task creation or wake paths whose
fixed Expert Squad scheduler inherits the base Tool set. The Task creator
(user, Agent, Mission, Work, or API) is not causal; they all converge on the
same Orchestrator scheduler construction.

### Consumer scope

| Consumer | Materialization path | Impact |
| --- | --- | --- |
| Chat / Work / Mission native Sessions | `ToolRegistry.runtimeTools` | Search is registered and materialized; not affected by this missing scheduler map entry. |
| Projected Task workers | `ToolRegistry.projectedWorkerTools` | Search is registered and materialized; not affected by this missing scheduler map entry. |
| Task scheduler | exact `runtimeContract.projectedTools` from `createOrchestratorTools` + `projectOrchestratorTools` | Affected. Exact-runtime mode deliberately skips registry auto-materialization. |
| Control/helper identities | Search is not projected | Not affected and should remain outside the discovery surface. |

### Failure-depth scope

The empty Active panel is one instance of a broader pre-message lifecycle
hole:

1. Task creation writes `time_started`.
2. Orchestrator setup can fail during effective-config resolution, scheduler
   capability resolution, model resolution, durable child-Session setup, Tool
   construction/projection, MCP ownership, system-context construction, or
   runtime-contract installation.
3. The current catch writes `task.error` with ordinary `updateTask`.
4. Ordinary updates never write `time_completed`.
5. `deriveTaskStatus` therefore returns `active`.
6. If no prompt message or Session terminal fact was persisted, conversation
   hydration has no visible item and the Overlay correctly renders its empty
   Task state.

The existing `missing-model-fast-fail.test.ts` and
`startup-error-envelope.test.ts` explicitly preserve this incorrect
`active + time_completed=null` behavior. They are stale negative contracts and
must be replaced with positive terminal-failure contracts rather than updated
to keep the bug.

Failures after the first message has materialized are different: the transcript
already has a real participant turn and SessionLoop can emit provider/processor
error facts. They remain under the stream-error and retry evidence contract and
must not be collapsed into the startup settlement path.

## Causal chain

### Observable symptom

The Overlay shows `Conversation updates will appear here`, the Task title, and
`Active`, with no Agent message.

### Direct trigger

`projectOrchestratorTools` rejects `capability_search` because the scheduler
capability contains that ID but `createOrchestratorTools` does not.

### Deep design cause

The capability foundation updated the declarative Tool pools and shared
registry, but the Task scheduler uses a deliberately exact, separately
constructed Tool map. The implementation record treated “ID appears in every
production Tool pool” as equivalent to “every production runtime materially
builds that Tool.” Those facts are equivalent for native Sessions and workers,
but not for the exact projected scheduler.

This is a declaration/materialization ownership gap, not an Expert Squad
selection error and not an Overlay filtering error.

### Lifecycle cause

The Orchestrator catch path assumes a future scheduler decision will convert a
recorded setup error into a Task outcome. That assumption is impossible when
the scheduler itself could not reach its first prompt. The Host records an
error but leaves the only scheduler lifecycle owner active, so no participant
remains capable of making the expected decision.

### Visibility cause

The conversation UI intentionally renders real messages, interactions, and
Session lifecycle cards. A `task.updated.summary` is a Task fact, not a
conversation message. Because startup emitted neither a message nor a terminal
Session lifecycle fact, the UI had nothing legitimate to render.

### Why prior validation did not catch it

- `capability/catalog.test.ts` asserted that role/template arrays contain
  `capability_search`, not that the concrete scheduler map contains it.
- `capability-session-loop.test.ts` executed search through a native Chat
  Session, which uses `ToolRegistry` and therefore passed.
- Resolver tests correctly reject missing materialization maps, but use
  intentionally incomplete fixtures and did not compose the actual
  `createOrchestratorTools` output with the built-in `general` scheduler.
- The existing real scheduler wake test does expose the failure, but it was not
  included in the capability foundation's focused test list.
- Startup-error tests codified active/non-terminal failure rather than the
  user-visible terminal contract.

## Implementation result

- `CapabilitySearchTool` remains the single search implementation.
  `createCapabilitySearchAiTool` now adapts it into the exact Orchestrator Tool
  map through `createAiSdkToolFromInfo` and resolves the Task/Session effective
  Config only when the persisted tool call executes.
- `createOrchestratorTools` materially builds `capability_search`; the strict
  Resolver projection remains unchanged.
- `withTaskToolInvocation` now preserves the complete immutable Harness and
  permission-layer surface instead of dropping those facts while copying the
  invocation authority.
- The durable Orchestrator Session is created before scheduler Config,
  capability, model, Tool, MCP, context, and runtime-contract preparation.
- Each wake records its starting persisted-message watermark. A non-abort
  failure that leaves that watermark unchanged is settled as
  `orchestrator-runtime / prepare-first-message`: one infrastructure Artifact,
  one terminal-error Session status, and one canonical failed Task transition
  with a valid start/completion interval.
- Settled Session publication now reuses the canonical lifecycle bridge, which
  stamps `channel`, `agentID`, `resolvedRole`, parent Session, and timeline
  identity before persisting the protocol event.
- A terminal lifecycle event with no message now materializes one real
  lifecycle-only agent card. A later successful retry migrates that
  deterministic card into the first message-turn card instead of creating a
  second representation.
- Mid-prompt failures that materialize a message remain on the existing stream
  error contract; control aborts remain control-flow facts.
- Non-inheriting production `opentest` and the generated portable template now
  declare `capability_search` explicitly.
- The stale active/non-terminal startup tests were rewritten as positive
  terminal lifecycle contracts. A new API contract proves conversation hydrate
  exposes valid Task timing, failed Task facts, the infrastructure event, and
  the fully enriched terminal Orchestrator lifecycle event. The prohibited
  Overlay CSS/source assertion test was deleted without running it.

### Real Desktop acceptance evidence

- Isolated server root:
  `/tmp/opencorvus-capability-fix.UUw2OZ`; the running production Desktop and
  database were not changed.
- Controlled failure Task:
  `tsk_fb0b917b200184CSQ1x234d79N`.
- Screenshot:
  `/tmp/opencorvus-capability-fix.UUw2OZ/startup-failure-card.png`.
- Manual review confirmed `Failed · 0s`, one visible `ORCHESTRATOR` error card,
  the exact ProviderModelNotFound error, and no conversation-load exception or
  empty-update placeholder.
- The isolated provider catalog reported `connected: []`. A live healthy-model
  Task therefore could not be executed without importing credentials into the
  isolated profile. The real scheduler first-turn boundary remains covered by
  the production-path non-UI regression; this limitation is not presented as
  a successful healthy visual run.

## Repair design

### 1. Materialize capability search in the exact scheduler map

Add a synchronous Orchestrator AI SDK Tool constructor beside
`CapabilitySearchTool`.

- Reuse the exported `CapabilitySearchInput` schema and one shared description.
- Resolve the exact execution Session/config at Tool-call time.
- Delegate Tool initialization/execution through `createAiSdkToolFromInfo` so
  validation, truncation, typed capability catalog search, Harness projection,
  and real tool-call ownership stay single-sourced.
- Add the resulting Tool under `capability_search` in
  `createOrchestratorTools.publicTools`.
- Keep `projectOrchestratorTools` strict. A full-closure test must compare the
  resolved scheduler projection with the concrete projected map.

This avoids an async conversion of 143 callers, avoids a second search
implementation, and makes the transport difference explicit in the same way
as existing artifact and interactive-artifact Tool adapters.

### 2. Give startup failure a real Session owner

Create/reuse the durable Orchestrator child Session immediately after Task root
lineage validation, before effective config, capability, and model setup.

The Session is the scheduler's real conversation/audit identity. Creating it
early does not invent a message and does not imply that an LLM prompt started.
It makes every subsequent scheduler setup failure attributable to one durable
participant.

### 3. Split pre-message settlement from in-prompt error handling

Introduce one scheduler-startup failure funnel used by:

- effective config / capability resolution failures;
- model resolution failures;
- Tool construction/projection failures;
- pre-prompt MCP/context/runtime-contract failures; and
- a `SessionPrompt` failure that leaves the durable message watermark
  unchanged.

The funnel must:

1. serialize the existing structured Orchestrator error envelope;
2. persist one `task-infrastructure-error` with
   `component=orchestrator-runtime`,
   `operation=prepare-first-message`, exact error name/reason, and Session ID;
3. publish the settled Orchestrator Session terminal status
   `{type:"terminal", reason:"error", error:<exact reason>}`;
4. call `terminalTask` with `status="failed"`, the structured error, and one
   exact completion time; and
5. release any not-transferred scoped MCP owner.

Use the message watermark/persisted-message fact, not an error-name or text
classifier, to distinguish “no turn ever materialized” from a later stream
failure.

Retain the existing in-prompt stream-error artifact path when a real new
message exists. Abort/cancellation remains its existing explicit control-flow
contract.

### 4. Preserve natural message semantics

Do not append an assistant, user, operator, system, or hidden message for the
Host failure. The visible facts are:

- a real Orchestrator Session terminal error;
- a failed Task with exact error and completion time;
- a durable infrastructure Artifact/protocol event; and
- zero messages if the LLM never received a turn.

The existing tree writer can render the lifecycle error card. If manual visual
acceptance proves that a terminal Session-without-message is not visible, fix
the Session lifecycle card projection itself; do not convert Task summaries
into messages or add an empty-state-only fallback.

### 5. Align package contracts

Review every repository Expert Squad scheduler:

- inherited schedulers receive search from the repaired base projection;
- `opentest` deliberately disables inheritance, so either explicitly declare
  `capability_search` or revise the architecture statement that every
  production Agent receives it;
- update the portable template artifact consistently if explicit declaration
  is the chosen non-inheriting contract.

The expected direction is explicit declaration for non-inheriting production
schedulers, preserving the “every production Agent” architecture without
forcing unrelated base Tools.

## Implementation sequence

1. Add the capability-search Orchestrator AI SDK adapter and concrete scheduler
   Tool entry.
2. Add the exact scheduler declaration/materialization closure regression and
   make the existing `general` production wake test pass.
3. Move durable Orchestrator Session ownership before failure-prone setup.
4. Add the single pre-message failure settlement funnel and replace ordinary
   `updateTask({error})` startup writes with infrastructure evidence,
   terminal Session status, and `terminalTask(failed)`.
5. Rewrite the stale missing-model/startup-envelope tests as positive failed
   lifecycle contracts. Delete their negative assertions; do not retain both
   behaviors.
6. Add Task conversation route coverage proving that a startup failure
   hydrates exact failed Task facts and a terminal-error Orchestrator Session
   event with no fabricated message.
7. Add a real first-turn scheduler regression proving the built-in `general`
   projection reaches `SessionPrompt`, persists a user/assistant turn, and
   includes executable `capability_search`.
8. Align non-inheriting production/package template scheduler declarations.
9. Delete the discovered prohibited Overlay empty-state source-assertion test
   without running it.
10. Run focused non-UI contracts, package typecheck, API/docs checks, and
    document health.
11. Build/package the Desktop application, open a fresh test Task without
    changing the currently running production scene, and manually inspect
    screenshots of:
    - a healthy first Orchestrator turn; and
    - a controlled startup failure showing failed Task status and a real
      Orchestrator error lifecycle card.
12. Perform a second scoped review of Tool ownership, failure ownership,
    Session/Task terminal ordering, protocol visibility, and retry semantics.

## Verification plan

### Focused positive non-UI tests

```text
packages/opencorvus/test/capability/catalog.test.ts
packages/opencorvus/test/tool/ai-sdk-adapter.test.ts
packages/opencorvus/test/conversation/capability-session-loop.test.ts
packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts
packages/opencorvus/test/orchestrator/missing-model-fast-fail.test.ts
packages/opencorvus/test/orchestrator/startup-error-envelope.test.ts
packages/opencorvus/test/orchestrator/session-reuse.test.ts
packages/opencorvus/test/server/task-conversation-routes.test.ts
packages/opencorvus/test/engine/terminal-decision-log-bundle.test.ts
```

Required positive outcomes:

- resolved `general` scheduler Tool IDs equal the exact projected concrete
  Tool IDs;
- `capability_search` executes with Task scheduler caller identity and returns
  the expected Harness-visible catalog entry;
- a healthy first wake persists real prompt messages;
- a pre-message failure yields a failed Task with completion time, exact
  structured error, infrastructure Artifact, task terminal event, and
  terminal-error Orchestrator Session event;
- conversation hydration contains no fabricated message while still exposing
  the real Session lifecycle error;
- Retry/Replan sees a terminal failed Task rather than an active orphan.

### Repository checks

```text
bun run --cwd packages/opencorvus typecheck
bun run api:routes-check
bun run docs:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

### Manual visual acceptance

- Use Node-driven real browser/Desktop interaction only; do not create or run a
  UI test file.
- Bind screenshots to the selected Task conversation region.
- Confirm the healthy Task visibly renders its first real turn.
- Confirm the controlled pre-message failure visibly renders the Orchestrator
  lifecycle error and failed Task status at rest.
- Confirm no duplicate titlebar, fabricated message, indefinite Active pulse,
  or empty `Conversation updates will appear here` panel remains for the
  failed case.

## Non-goals

- Redesigning the conversation empty-state visual language.
- Rendering Task protocol summaries as chat messages.
- Changing worker, Chat, Work, or Mission ToolRegistry semantics.
- Replacing strict Expert Squad Tool projection with registry fallback.
- Reclassifying all provider retries or mid-stream failures as terminal
  startup failures.
- Mutating or repairing the currently affected production database row during
  implementation without separate operator approval.
