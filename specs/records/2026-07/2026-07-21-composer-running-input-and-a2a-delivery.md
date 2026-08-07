# Composer Running Input And A2A Delivery

Date: 2026-07-21
Status: Implemented and under final repository reconciliation
Owner: Codex

## Recall

### User requirement

- While an Agent is working, the Composer primary action currently stays on Stop even after the operator enters new text.
- The Composer must notice a new non-empty draft immediately and expose Send without requiring the current Agent turn to stop first.
- Before changing the interaction, verify that the existing A2A (Agent-to-Agent) and conversation-delivery protocols can durably accept the new input and define when it becomes observable to the running work.
- Implement the correction and test it.

### Acceptance criteria

1. With active work and an empty draft, the primary Composer action remains Stop and keeps the existing cancellation behavior.
2. As soon as the active Composer contains non-whitespace text, the same primary action becomes Send, including its icon, tone, title, accessible label, button type, DOM (Document Object Model) mode, and click/Enter behavior.
3. A successful send clears the draft and returns the still-active Composer to Stop; duplicate submissions remain blocked while the send request itself is in flight.
4. Running Chat and Mission input continues through `session/:sessionID/prompt_async`: the visible user message is persisted before queueing, and same-session generations execute serially under `TaskQueueService`.
5. Running Task input continues through `task/:taskID/message`: the visible Task-root operator message is persisted before the scheduler wake. It is not silently retargeted to an arbitrary child Agent.
6. Explicit child-Agent guidance continues to use `task/:taskID/session/:sessionID/operator-steer`; worker-to-Orchestrator control continues to use the typed `request_orchestrator_decision` terminal handoff. The Composer repair must not create a second A2A route.
7. Tests cover the primary-action matrix, click and keyboard submission during active work, post-submit reversion, canonical request routing, and durable queued delivery.
8. A real isolated desktop page is exercised with Node-launched browser automation, visually inspected, and captured in both the active-empty and active-with-draft states without refreshing or restarting the user's running OpenCorvus or Overlay.

### Hard constraints

- Do not make concurrent model generations consume one mutable session transcript. New input is accepted immediately, then consumed at the canonical serial execution boundary.
- Do not infer a child-Agent target from the selected Task or currently visible card.
- Do not add a fallback route, hidden message, synthetic wake, host routing gate, status machine, or second busy-state source.
- Preserve the textarea as the single draft source and `panelMessage` as the single Composer delivery entry point.
- Do not restart, stop, refresh, or otherwise interfere with the user's running OpenCorvus or Overlay processes.
- Browser validation uses Node, never Bun, and targets an isolated test page.

### Architecture and historical records read

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-15-session-background-execution-ownership.md`
- `specs/records/2026-07/2026-07-20-task-research-dispatch-observability-systemic-repair.md`
- `specs/records/2026-07/2026-07-21-chat-session-lifecycle-convergence.md`
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`

### Whole-repository grep evidence

- `rg -n "props\\.busy|hasText|handleSubmit|handleKeyDown|sendDisabled|onStop" packages/overlay/src/components/ChatComposer.tsx`
- `rg -n "<ChatComposer|busy=|onSubmit=|onStop=" packages/overlay/src packages/overlay/test -g "*.tsx" -g "*.ts"`
- `rg -n "panelMessage\\(|prompt_async|enqueuePromptAfterPersistingUserMessage|/message|operator-steer|dispatchTaskLoop\\(|runTaskLoop\\(" packages/overlay/src packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.tsx"`
- `rg -n "request_orchestrator_decision|createAgentCoordinationRequest|respond_agent_coordination|agent\\.coordination" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "a2a_task_queue|TaskQueueService|same session|running task" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`

The broad protocol inventory includes generated contracts, historical assertions, tests, and unrelated message APIs. The production call-point disposition below identifies every owner that can affect this repair; no same-purpose Composer or delivery implementation was found.

### Independent Agent feedback

No sub-Agent was started. The current collaboration policy prohibits delegation unless the user explicitly requests it, so the protocol audit and implementation review remain the primary Agent's responsibility.

## Causal chain

1. `ChatComposer` deliberately keeps its textarea enabled while `props.busy` is true, so the draft signal is captured correctly by `text()` and `hasText()`.
2. The submit handler and Enter handler both return unconditionally on `props.busy`, discarding the captured signal at the interaction boundary.
3. The primary button's disabled state, title, accessible name, ID, tone, type, mode, click branch, and icon all derive directly from `props.busy`, so none of them can react to the non-empty draft.
4. The backend is not the direct cause. Chat and Mission already persist the new user message before adding a serial session-queue item; Task already persists a Task-root operator message before requesting an Orchestrator wake; explicit child-Agent steering already has a separate durable route.
5. Therefore the root repair is to derive the Composer primary action from both active work and the current draft, while leaving delivery ownership unchanged. "Immediate" means immediate UI recognition and durable acceptance; model observation occurs at the existing safe serial boundary, not by racing two turns against one transcript.

## Call-point disposition

| Call point                                                                                                                    | Current role                                                     | Disposition                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/ChatComposer.tsx` `text` / `hasText`                                                         | Canonical local draft signal                                     | Keep as the single source.                                                                                            |
| `ChatComposer.handleSubmit`                                                                                                   | Form submission boundary                                         | Remove the unconditional active-work rejection; retain enabled, upload, non-empty, and request-in-flight protections. |
| `ChatComposer.handleKeyDown`                                                                                                  | Enter / Shift+Enter behavior                                     | Permit Enter submission for a non-empty active draft; keep empty active input non-submitting.                         |
| `ChatComposer` primary button projections                                                                                     | Stop/Send presentation and behavior                              | Derive all projections from one shared primary-action decision.                                                       |
| `packages/overlay/src/main.tsx` `busy`                                                                                        | Canonical projection of request, Task, and Work Ledger execution | Keep unchanged; it says whether work is active, not whether a new draft is sendable.                                  |
| `packages/overlay/src/main.tsx` `onSubmit` / `onStop`                                                                         | Canonical Composer action routing                                | Keep unchanged. Send continues to `panelMessage`; Stop continues to exact cancellation ownership.                     |
| `packages/overlay/src/services/chat.ts` `panelMessage`                                                                        | Selected session/Task delivery discriminator                     | Keep unchanged; add route-level regression evidence rather than a parallel route.                                     |
| `packages/opencorvus/src/server/routes/session.ts` `prompt_async`                                                             | Chat/Mission durable acceptance                                  | Keep; verify persistence-before-queue and same-session serial execution.                                              |
| `packages/opencorvus/src/scheduler/task-queue-service.ts`                                                                     | Session execution owner                                          | Keep; a running item excludes a second running item for the same session.                                             |
| `packages/opencorvus/src/server/routes/task-api/index.ts` `/message`                                                          | Task-root operator input                                         | Keep; verify visible persistence and scheduler wake while work is active.                                             |
| `packages/opencorvus/src/engine/queue.ts` `dispatchTaskLoop` and `packages/opencorvus/src/orchestrator/loop.ts` `runTaskLoop` | Task wake acceptance and serialized Orchestrator execution       | Keep; do not introduce concurrent Task-loop transcript mutation.                                                      |
| `/task/:taskID/session/:sessionID/operator-steer`                                                                             | Explicit child-Agent guidance                                    | Keep isolated from the main Composer.                                                                                 |
| `request_orchestrator_decision`                                                                                               | Typed worker-to-Orchestrator control handoff                     | Keep unchanged; ordinary operator input is not a control handoff.                                                     |

## Implementation plan

1. Add one pure Composer primary-action decision and use it for every Send/Stop projection.
2. Permit non-empty active drafts through submit and Enter while preserving upload and duplicate-request protections.
3. Add unit/source regressions plus production-route queue/delivery evidence.
4. Run focused tests, Overlay type checking, protocol tests, documentation health checks, and the repository-required validation that is relevant to the touched surfaces.
5. Start an isolated page, exercise the actual interaction with Node browser automation, inspect screenshots, and correct any visual or keyboard regression before delivery.
6. Perform a second diff review, commit with the required `dsw-33987` prefix, reconcile the current branch with `myhexin`, and push through hooks.

## Verification ledger

| Verification                                                                                       | Result                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer action unit/source regressions plus adjacent Composer, lifecycle, and architecture suites | `178 pass, 0 fail` across six focused Overlay files.                                                                                                                                                                                                                                                      |
| Overlay type checking                                                                              | `bun run --cwd packages/overlay typecheck` passed.                                                                                                                                                                                                                                                        |
| Chat/Mission active-generation delivery                                                            | The full `session-prompt-async` file passed `13 pass, 0 fail`. The new regression proves the second visible user message exists while the first queue row is `running`, the second row remains `queued`, and both execute exactly once in serial order.                                                   |
| Same-session queue ownership                                                                       | `does not claim queued task when same session already has running task`: `1 pass, 0 fail`.                                                                                                                                                                                                                |
| Task-root input with live ownership                                                                | Both the queued-wake ownership test and the real `/task/:taskID/message` route test passed without aborting active build ownership: `2 pass, 0 fail`.                                                                                                                                                     |
| OpenCorvus type checking                                                                           | `bun run --cwd packages/opencorvus typecheck` passed.                                                                                                                                                                                                                                                     |
| Repository type and generated-contract checks                                                      | Root `bun run typecheck` passed all nine scoped package tasks; `bun run api:routes-check` and `bun run docs:check` passed.                                                                                                                                                                                |
| Real desktop interaction                                                                           | Node-launched Playwright built the current Overlay, selected a Task, submitted its first continuation, verified active-empty Stop, typed an active draft, verified enabled Send, submitted by click, submitted another active draft by Enter, and observed Stop again after each clear: `1 pass, 0 fail`. |
| Visual review                                                                                      | Personally inspected `.scratch/composer-running-active-empty.png` and `.scratch/composer-running-active-draft.png`. The fixed-size action changes from the red Stop glyph to the neutral Send glyph without Composer reflow, clipping, or overlap.                                                        |
| In-app Browser skill review                                                                        | The Browser skill rejected direct `file://` navigation to the saved isolated capture under its URL policy. No workaround was attempted; the required interactive and screenshot evidence remains the successful Node-launched real Overlay test above.                                                    |
| Historical documentation links                                                                     | Passed.                                                                                                                                                                                                                                                                                                   |
| Document health                                                                                    | Product/document assertions passed. The tracked-record assertion currently reports the new record plus two unrelated concurrent untracked July records referenced by the shared indexes; rerun after selective commit and concurrent-work reconciliation.                                                 |

## Implementation result

- `composerPrimaryAction` is the single decision: active work with no draft means Stop; every other draft state means Send, with empty idle Send remaining disabled by the existing predicate.
- `ChatComposer` now uses that decision for ID, type, tone, busy marker, mode, title, accessible label, click branch, icon, disabled behavior, and Enter handling.
- The canonical `busy` source, `panelMessage` discriminator, Task-root route, explicit `operator-steer` route, typed worker handoff, and backend execution owners are unchanged.
- No concurrent generation, hidden message, fallback route, child-target inference, host gate, or duplicate lifecycle source was introduced.
