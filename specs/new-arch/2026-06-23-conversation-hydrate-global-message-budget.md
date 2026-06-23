# Conversation Hydrate Global Message Budget

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- SSE: Server-Sent Events, the selected task live-update stream.
- DB: Database, the SQLite persistence layer.

## Task Definition

Make task conversation hydrate apply its bounded message budget globally across
the task session tree. The current bounded path reads up to 80 messages per
session, so a long task with many sessions can still return thousands of
messages into `agentView` and force expensive frontend hydration during task
selection.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no gate, no duplicate source, recall disk plans before edits, test every change, commit and push every round. |
| `2026-06-06-overlay-live-efficiency-safe-fix.md` | `/task/:taskID/conversation?tail_limit=N` must use bounded transcript loading while preserving selected SSE behavior and response shape. |
| `2026-06-19-system-performance-high-confidence-pass.md` | Session-specific routes can read one session directly, but task hydrate must preserve task response shape and avoid unrelated-session amplification. |
| `2026-06-22-task-switch-stable-request-keys.md` | Task-switch request fan-out must be fixed at trigger/data-owner boundaries, not hidden behind broad frontend caches. |
| Mill read-only audit | Task click can still hydrate `CONVERSATION_TAIL_MESSAGE_LIMIT` per session; multi-session tasks amplify payload, `hydrateConversationView()`, and `hydrateConversationAgentView()`. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Task hydrate route | `orchestrator.ts` computes `transcriptLimit = max(tailLimit, CONVERSATION_TAIL_MESSAGE_LIMIT)`. | Keep the same limit value but apply it globally across sessions. |
| Current transcript reader | `loadTaskTranscript(taskID, { perSessionLimit })` calls `Session.messages({ sessionID, limit: perSessionLimit + 1 })` for every session. | Replace only the bounded branch with a global multi-session reader. |
| Full transcript callers | `loadFullTaskTranscript(taskID)` calls `loadTaskTranscript(taskID)` without a limit. | Keep full callers unchanged; do not silently cap full export/history paths. |
| Message assembly | `Message.stream()` owns MessageTable/PartTable row assembly and returns chronological messages through `Session.messages()`. | Add `Message.latestAcrossSessions()` beside that owner so route code does not duplicate part assembly policy. |
| Frontend hydrate | `packages/overlay/src/services/conversation.ts` hydrates `transcript` and `agentView` from the route. | Keep frontend behavior unchanged; reduce server payload instead of adding frontend gates. |
| Tests | Existing bounded hydrate test covers one session and only asserts per-session `agentView.messageIDs.length <= 80`. | Add a 45-session regression asserting total `agentView` message IDs stay within the global budget. |

## Root Cause

The route was previously changed from full transcript scan to bounded
per-session reads, but the budget was applied independently to every session.
That preserves correctness for single-session tasks while still scaling
linearly with task session count. The frontend then receives and hydrates an
oversized `agentView` even when the visible transcript tail is small.

## Fix Plan

1. Add `Message.latestAcrossSessions({ sessionIDs, limit })`, using the same
   MessageTable/PartTable assembly shape as `Message.stream()`.
2. In the bounded `loadTaskTranscript()` branch, read `transcriptLimit + 1`
   latest messages across all task sessions.
3. Preserve `truncated` and `history.hasMore` by trimming the extra row after
   the global read.
4. Keep unbounded `loadTaskTranscript()` unchanged for full transcript callers.
5. Add a multi-session route regression where old per-session bounding would
   return more than 80 `agentView` message IDs.
6. Run focused route tests, opencorvus typecheck, self-review, commit, and push.

## Acceptance

- Bounded task conversation hydrate reads and returns at most the global
  transcript budget for `agentView`, independent of session count.
- `tail_limit` response semantics and `history.hasMore` remain correct.
- Full transcript callers are not capped by this change.
- No frontend gate, stale cache, fallback route, or duplicate message assembly
  path is added.
- Focused tests, typecheck, self-review, commit, and push pass.

## Verification

- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "bounds hydrate|global agentView" --timeout 30000`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --timeout 30000`

## Visual Note

This round changes the server hydrate payload and message reader only; no UI
component, CSS, or layout code changed. A separate exploratory browser visual
run of `conversation-agent-rail-scroll-browser.test.ts` exposed an existing
drag-state failure in `ConversationAgentRail`; that is not part of this server
payload diff and will be handled as the next UI round.

## Self Review

The bounded branch now reads the latest `transcriptLimit + 1` messages across
the task session tree and trims the extra row to preserve `history.hasMore`.
Full transcript callers still use the original unbounded per-session path. The
new `Message.latestAcrossSessions()` lives beside `Message.stream()` and uses
the same MessageTable/PartTable assembly shape, so the route does not introduce
a second message serialization source.
