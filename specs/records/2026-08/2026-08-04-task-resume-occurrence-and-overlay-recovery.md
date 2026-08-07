# Task Resume, Queue Occurrence, and Overlay Recovery Repair

## Recall

### User request

- Deeply investigate why two Mission/Task objects could not continue, why an audit or worker failure was allowed to abandon delivery, and why answering a question produced an HTTP 404-like empty surface.
- Repair the causes, use multiple independent agents for analysis and verification, restart the product when needed, and recover the affected objects without discarding their history.

### Acceptance criteria

- A stale queue occurrence can cancel only its own physical Session prompt owner; its terminal database transition cannot release the next same-Session occurrence until that owner has physically finished.
- A subsequent queued wake receives a fresh, non-aborted owner and reaches its own explicit terminal result.
- A terminal Task exposes operator-owned Retry and Replan actions in the existing selected-item menu. Retry/Replan reopen the same Task identity through the existing typed control API; a cancelled Task requires explicit confirmation.
- Mission conversation hydration uses the committed workspace-epoch single source and displays the existing durable transcript rather than an empty projection.
- Session Server-Sent Events (SSE, a streaming HTTP event channel) survive ordinary project-runtime cache eviction when the stream no longer depends on that runtime.
- Terminal Session status publication is awaited within prompt settlement, so a closing runtime lease cannot strand idle/terminal publication.
- The packaged Overlay and embedded sidecar are rebuilt and restarted, then the affected Mission and Task are checked through the real UI. UI validation is manual page interaction and screenshot review only.

### Hard constraints

- Do not add a Mission/agent route to `retry_task` or `replan_task`: only an explicit operator typed intent may reopen a terminal Task.
- Do not add fallback, compatibility, keyword routing, a host workflow gate, a second lifecycle source, database migration, or reset the production database.
- Do not add, modify, or run UI automation tests. Add only positive non-UI contract tests.
- Preserve unrelated dirty Dispatch Turn work. Do not reset, stash, overwrite, or create a worktree.
- Commit subjects use `dsw-33987`; delivery is pushed to the `git-cc` remote after hooks pass.

### Evidence and sources read

- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`
- `specs/records/2026-08/2026-08-04-single-runtime-owner-and-phase-closure-recovery.md`
- Production database `C:/Users/hengu/AppData/Local/opencorvus/data/opencorvus.db` and log `C:/Users/hengu/AppData/Local/opencorvus/log/2026-08-04T065714-11972-1.log`.
- Queue implementation and prompt ownership in `scheduler/task-queue-service.ts` and `session/prompt/state.ts`.
- Retry/Replan control routes, Overlay task service, current selected-item title menu, and app dialog primitive.
- Mission conversation API response: the affected Session currently returns 42 transcript messages, 42 projected messages, one Session, and one top-level agent.

### Whole-repository search results

- Retry/Replan backend routes and Overlay service functions already exist; no Overlay UI calls them.
- The Mission lifecycle contract intentionally excludes agent-authored Retry/Replan and tests enforce operator ownership.
- Queue recovery currently cancels by Session while an in-flight queue entry does not retain the exact prompt owner.
- The global Session event stream closes on `InstanceDisposed` even after it has detached from the project runtime lease.
- Many Session status publications use non-awaited calls around prompt/loop settlement.
- The installed Overlay and sidecar processes predate commits `e0e04616f8` and `6fbc6cf8bf`.

### Independent agent feedback

- Queue occurrence audit: production log ordering proves the first stale wake's callback rejected before its physical owner finished; the original drainer then claimed the second wake, which attached to the still-cancelled owner and inherited the identical cancellation.
- Retry surface audit: backend semantics are complete; the missing product surface is the existing selected Task title menu. Cancelled Retry/Replan must confirm, and board hydration must require a fresh read.
- Mission projection audit: durable messages were never absent. The empty debug card was captured before hydration during the old startup restore race. A separate SSE eviction coupling causes repeated reconnects and a closing-lease publication race remains outside the prior server-owner commit.

## Causal chain

1. The stale queue recovery path cancels a Session rather than one queue occurrence's exact prompt owner.
2. Cancellation rejects the queue callback immediately, while physical prompt cleanup continues.
3. The original queue drainer marks the first row failed and claims the next row before physical owner completion.
4. The next Session loop attaches to the still-present cancelled owner and receives the previous occurrence's cancellation.
5. The affected terminal Task has valid backend Retry/Replan controls, but the client exposes no operator action, making the correct recovery path unreachable.
6. Independently, the old Overlay restore race records selected source before conversation hydration, and global SSE incorrectly follows runtime eviction; together they make durable conversation state appear empty or unstable.

## Implementation

1. Capture the exact prompt owner for each in-flight queue row, settle that owner before the queue occurrence resolves, and use exact-owner cancellation everywhere an in-flight row is cancelled or recovered.
2. Add positive queue regression coverage for two same-Session occurrences and typed timeout/complete outcomes.
3. Add Retry/Replan to the existing selected terminal Task menu, with cancelled confirmation and fresh board hydration; add or extend positive route coverage for same-ID reopening.
4. Remove global Session SSE closure from project runtime eviction and await terminal status publication inside prompt settlement. Add positive protocol/runtime tests.
5. Build and restart the packaged Overlay, verify unique runtime ownership and stable SSE heartbeats, recover the Task through explicit UI action, and confirm the Mission renders all durable messages.
6. Ask an independent agent to review the final diff and evidence before commit/push.

## Verification commands

- Targeted scheduler, Session protocol/runtime, and Task Retry/Replan non-UI tests.
- Relevant TypeScript type checks, API route check, documentation health tests, and production build.
- Real packaged application interaction with manual screenshots for the Task menu, cancelled confirmation, same-ID resumed Task, and hydrated Mission conversation.

## Final root-cause extension

The first production Retry proved that queue delivery and prompt ownership were repaired, but exposed two deeper occurrence-identity defects:

1. A reused Orchestrator Session handled Retry/Replan with `SessionPrompt.loop()` and did not append a new natural Turn. The provider history therefore still ended with the prior terminal assistant summary. All three retried Tasks consumed their queued operator intent, produced a new assistant message with `finish=stop` and no tool call, and remained falsely `active`. The fix carries the persisted queued-wake ID into the Orchestrator boundary and materializes the real operator Retry/Replan control as a visible, auditable user-role message in the same durable Session. Its deterministic message ID derives from the single queued-wake identity, and replay reuses the same message/reply instead of creating a second occurrence.
2. A Mission `mission.child_task_result` wake recorded only the mutable Task ID and status. Reopening that same Task ID made historical conversation projection reread the current nonterminal row, causing a 500 response that the Overlay surfaced as an empty/404-like conversation. The fix records the immutable terminal event reference, Task title snapshot, status, and exact completion-decision artifact ID in every new child-result wake. Projection validates and reads that historical occurrence authority instead of the mutable current Task row.

The operator subsequently deleted the three affected Tasks. Recovery dispatch and database reset were therefore stopped. The remaining production database contains two completed Tasks, zero open/running/blocked/cancelled Tasks, passes SQLite integrity and foreign-key checks, and requires only an explicit data repair of its two retained pre-fix Mission child-result wakes before the strict reader is deployed. No schema migration or database rebuild is justified.
