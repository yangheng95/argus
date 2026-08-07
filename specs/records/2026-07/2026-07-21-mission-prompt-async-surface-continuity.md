# Mission prompt_async Surface Continuity

Date: 2026-07-21
Status: Implemented
Owner: Codex

## Recall

### User request

The user reported that interrupting a Task leads to `panel tool requires ctx.extra.surface to authorize surface-specific actions`.

### Acceptance criteria

- A user-authored prompt submitted to a Mission through `POST /session/:sessionID/prompt_async` persists the Mission's canonical `panel` surface.
- The queued prompt metadata and the real visible user message carry the same surface, so `SessionLoop` projects it into later panel-tool calls.
- Task-queue execution preserves the explicit prompt context; it does not infer authorization from agent names, queue source, or interruption state.
- Non-Mission sessions retain their current surface contracts, and a truly surface-less panel-tool call remains rejected.
- Focused route, queue, panel authorization, typecheck, and documentation-health tests pass.
- No running OpenCorvus or Overlay process is restarted, stopped, refreshed, or reused for mutation-based verification.

### Hard constraints

- Keep `PanelTool.resolvePanelSurface` fail-fast; the repair belongs at the dispatcher input boundary.
- No fallback, compatibility alias, gate, keyword rule, hidden message, synthetic message, or second authorization source.
- Mission's canonical control-plane surface is `panel`; the caller ingress surface remains provenance and does not redefine Mission authorization.
- Preserve unrelated worktree changes, use the required `dsw-33987` commit prefix, and push only the current main delivery branch to the git-cc `myhexin` remote.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-14-iwc-opentest-latest-protocol-e2e.md`
- `specs/records/2026-07/2026-07-16-chat-mission-surface-attachment-forwarding.md`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/mission/session.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/test/server/session-prompt-async.test.ts`
- `packages/opencorvus/test/scheduler/task-queue-service.test.ts`
- `packages/opencorvus/test/task-api/mission-control-surface-continuity.test.ts`

### Whole-repository grep and runtime evidence

- `rg -n "panel tool requires ctx\\.extra\\.surface|ctx\\.extra\\.surface|surface: \"panel\"|prompt_async|scheduler\\.task_queue|SessionWake\\.wake" packages specs` found one fail-fast authorization owner, two session prompt route callers sharing `applySessionPromptRouteOverlay`, three explicit Mission wake callers that already use `surface: "panel"`, and one queue metadata/persistence pipeline that preserves `prompt.extra` while adding only `wake_reason`.
- The local main database contains two real failed `panel.create_task` parts in Mission session `ses_0806a61d2ffeWIm1lnItXh6AHj`. Both assistant messages have parent `msg_f82ffbf39001jeP2jIEfGzEmzQ`.
- That parent is a real user message whose `extra` contains only `wake_reason.source="scheduler.task_queue"`, `queueSource="session.prompt_async"`, and its queue Task ID. It has no `surface`.
- The Mission session metadata records the original right-sidebar caller, but authorization must not be reconstructed from that historical provenance.
- The failed request occurred after conflicting terminal/cancellation reconciliation, but the observable direct trigger is the later Mission `prompt_async` route projection. Interruption makes this queued continuation path visible; cancellation itself does not call the panel tool.
- `applySessionPromptRouteOverlay` gives right-sidebar Chat an explicit surface but only resolves identity for Mission. Both synchronous `/prompt` and asynchronous `/prompt_async` call this helper.
- `TaskQueueService.stampTaskQueueWakeReason` already merges `prompt.extra`, and the queue metadata plus visible-message persistence use the resulting prompt. The queue is therefore not the field-loss owner and must remain transport-only.

### Independent agent feedback

No sub-agent was launched. The active collaboration policy forbids spawning sub-agents unless the user explicitly requests them; this request did not.

## Diagnosis

The observable error is an authorization rejection, not the root cause. A user continuation submitted directly to an existing Mission goes through the generic session prompt route. That route re-establishes Mission agent identity but does not project the fixed Mission control-plane surface. The task queue faithfully persists this incomplete prompt and adds its structured wake reason. `SessionLoop` later faithfully exposes the persisted `extra` as tool context, so `PanelTool.resolvePanelSurface` correctly rejects `panel.create_task`.

The earlier interruption is causal only in routing: it is followed by a queued Mission continuation. Deriving a surface from `agent="mission"` inside PanelTool or TaskQueueService would create a second authorization source and conceal future dispatcher loss.

## Call-point disposition

| Call point                                                 | Current behavior                                                   | Disposition                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `POST /mission/wake`                                       | Explicitly calls `SessionWake.wake(... surface: "panel")`.         | Keep unchanged.                                                                          |
| `panel.wake_mission`                                       | Explicitly wakes the independent Mission with `surface: "panel"`.  | Keep unchanged.                                                                          |
| Mission child-Task terminal wake                           | Explicitly wakes Mission with `surface: "panel"`.                  | Keep unchanged.                                                                          |
| `applySessionPromptRouteOverlay`                           | Applies right-sidebar surface, but Mission receives identity only. | Add the fixed Mission control-plane overlay here for both `/prompt` and `/prompt_async`. |
| `TaskQueueService.enqueuePromptAfterPersistingUserMessage` | Merges `wake_reason` and preserves the supplied `extra`.           | Keep transport unchanged; prove preservation through the route test.                     |
| `PanelTool.resolvePanelSurface`                            | Rejects missing or invalid explicit surfaces.                      | Keep unchanged and retain negative coverage.                                             |

## Implementation plan

1. Add one Mission-owned prompt overlay helper that preserves authored prompt fields and explicitly projects `extra.surface="panel"`.
2. Apply it from the shared session route overlay when the authoritative session kind is `mission`; keep right-sidebar Chat and ordinary assistant behavior unchanged.
3. Extend the real `prompt_async` route regression to assert both stored queue input and persisted visible user-message surface.
4. Run focused route, task-queue, Mission surface-continuity, panel authorization, typecheck, formatting, diff, historical-link, and document-health checks.
5. Perform a second source/diff review, update this record with exact evidence, commit, fetch/reconcile, and push the current delivery branch to `myhexin`.

## Validation plan

- `bun test packages/opencorvus/test/server/session-prompt-async.test.ts -t "mission session prompt_async" --timeout 60000`
- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts -t "wake reason" --timeout 60000`
- `bun test packages/opencorvus/test/task-api/mission-control-surface-continuity.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/tool/panel.test.ts -t "surface" --timeout 60000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `git diff --check`

## Validation record

- Runtime evidence was collected read-only from the local main database before implementation. It binds the reported error to Mission session `ses_0806a61d2ffeWIm1lnItXh6AHj`, queue source `session.prompt_async`, parent user message `msg_f82ffbf39001jeP2jIEfGzEmzQ`, and two real failed `panel.create_task` parts. The parent message has a task-queue wake reason and no surface.
- The shared route overlay now applies the Mission-owned `panel` surface before either synchronous or asynchronous prompt dispatch. TaskQueueService remains unchanged and continues to preserve the supplied `extra` while adding only its structured wake reason.
- `bun test packages/opencorvus/test/server/session-prompt-async.test.ts -t "mission session prompt_async" --timeout 60000`: passed. The regression proves the real route stores `surface="panel"` in queue metadata and the visible persisted user message together with the exact task-queue wake reason.
- The complete `packages/opencorvus/test/server/session-prompt-async.test.ts` file passed after the change, covering Mission, ordinary assistant, visible-message persistence, file materialization, explicit queue start, and failure paths.
- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts -t "executes prompt immediately via shared executor" --timeout 60000`: passed, proving the shared queue executor still preserves its wake metadata contract.
- `bun test packages/opencorvus/test/task-api/mission-control-surface-continuity.test.ts --timeout 60000`: 2 passed, preserving terminal-result and right-sidebar-to-Mission surface continuity.
- Focused PanelTool tests passed, including the new negative regression that a Mission panel action with no dispatcher-supplied surface remains rejected and the existing right-sidebar actor restriction.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- Historical docs links and document-health tests passed; Prettier checks, `git diff --check`, and the final whole-repository surface call-point scan passed.
- Second review confirmed there are now four explicit Mission control-plane entry projections: direct Mission wake, right-sidebar handoff, child-Task terminal wake, and generic session prompt route continuation. No panel authorization, task-queue inference, Mission metadata schema, or fallback path was added.
- No running OpenCorvus or Overlay process was restarted, stopped, refreshed, or modified. The read-only database proves the old runtime failure; source/test acceptance does not claim that the already-running binary hot-reloaded this repair.
