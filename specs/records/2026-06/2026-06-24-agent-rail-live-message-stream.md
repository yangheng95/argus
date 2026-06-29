# Agent Rail Live Message Stream

Date: 2026-06-24
Status: Verified

## Acronyms

- SSE: Server-Sent Events, the selected task live update stream.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Fix the regression where the Conversation agent rail is not updated while an
agent is streaming and only appears after a webview refresh or a later full
conversation hydrate.

## Recall

| Source                                                   | Constraint carried forward                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                              | No fallback, no double source, no blind patching, inspect disk plans before edits, test every change, visually verify UI-related delivery, do not restart/refresh the live overlay process without explicit confirmation. |
| `2026-05-13-conversation-agent-workflow-rail.md`         | The rail is a Conversation-owned bottom strip, hidden when there are no real agent records, and must not create synthetic cards.                                                                                          |
| `2026-06-23-overlay-conversation-render-backpressure.md` | The mounted rail must read `conversationAgentStore.records` and must not restore component-level card-tree workflow scans.                                                                                                |
| `2026-06-23-agent-rail-visibility-regression.md`         | Tail hydrate already updates `conversationAgentStore`; visibility fixes must preserve the single `conversation-agents.ts` store owner.                                                                                    |

## Call Point Inventory

| Surface                                   | Evidence                                                                                     | Decision                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ConversationAgentRail.tsx`               | Reads only `conversationAgentRecordsForSource(boardStore.selectedSource)`.                   | Keep unchanged; no card-tree fallback or local scan.                                                               |
| `conversation-agents.ts`                  | Owns `hydrateConversationAgentView()` and source-keyed records.                              | Add the live `message.updated` projection here so the same store remains the rail source.                          |
| `events.ts`                               | `message.*` SSE writes `cardTreeStore`; only `task.messages.changed` schedules tail hydrate. | After a selected `message.updated` is accepted by tree-writer, update the rail store for the selected task source. |
| `conversation.ts`                         | Full hydrate and tail merge call `hydrateConversationAgentView()`.                           | Keep authoritative hydrate behavior; full `agentView` replaces live incremental records when received.             |
| `selected-task-recovery.test.ts`          | Covers `task.messages.changed` DB tail updating rail records.                                | Add direct `message.updated` coverage proving rail records appear without a refresh or tail hydrate.               |
| `conversation-agent-rail-records.test.ts` | Covers hydrated record targeting and source scoping.                                         | Add live-message record tests for top-level, goal-phase, filtered/user, and source scoping behavior.               |

## Root Cause

The current selected-task stream handles direct `message.updated` /
`message.part.*` events by writing only `cardTreeStore`. The rail's production
source, `conversationAgentStore`, is updated only by full
`hydrateConversation()` or scheduled `mergeLatestConversationTail()` when a
`task.messages.changed` notification arrives. During live streaming, the
message card can therefore appear immediately while the rail remains empty
until a later hydrate or page refresh.

This is not a rendering or Solid reactivity problem in `ConversationAgentRail`.
It is a missing projection edge from the selected live message stream into the
single rail store owner.

## Fix Plan

1. Add an exported live-message projection function in
   `conversation-agents.ts`.
2. Parse the same backend-stamped message metadata required by tree-writer:
   `channel`, `sessionID`, `id`, `time.created`, `parentSessionID`, and
   `goalID`.
3. Update or insert one record per real agent session for the active source key.
   User and filtered channels do not create rail records.
4. Preserve hydrate replacement semantics: `hydrateConversationAgentView()`
   remains the complete authoritative snapshot path.
5. Call the live projection from `events.ts` only after `writeToTree(event)`
   succeeds for `message.updated`.
6. Add focused unit tests and selected-stream tests.

## Acceptance

- A selected task `message.updated` event creates or updates rail records
  immediately without waiting for `task.messages.changed`, full hydrate, or
  page refresh.
- Top-level messages target `stage:session:<sessionID>:message:<messageID>`.
- Goal-phase `planner` / `build` messages target `step:<goalID>:<stepID>` and
  carry `phaseID`.
- User and filtered messages do not create rail records.
- `ConversationAgentRail.tsx` still has no component-level card-tree fallback,
  no `buildAgentWorkflow()` dependency, and no duplicate source.
- Focused tests and typecheck pass; browser rail visual QA is run in an
  isolated runner without touching the user's live overlay process.

## Verification

- PASS: `bun test packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/conversation-agent-rail.test.ts --timeout 30000`
- PASS: `bun run --cwd packages/overlay typecheck`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- PASS: `git diff --check`

## Visual QA

- Reviewed `.scratch/conversation-agent-rail-scroll-browser/rail-after-drag.png`:
  the task rail is visible as a narrow bottom strip with multiple agent avatar
  controls and no clipping.
- Reviewed `.scratch/conversation-agent-rail-scroll-browser/rail-coding-assistant.png`:
  the session rail shows a visible assistant avatar and non-empty strip.

## Self Review

- `ConversationAgentRail.tsx` remains unchanged and still reads only
  `conversationAgentRecordsForSource(boardStore.selectedSource)`.
- `events.ts` applies live rail projection only after `writeToTree(event)`
  succeeds for `message.updated`, so malformed stream events remain loud.
- `conversation-agents.ts` remains the single rail store owner. Full
  `hydrateConversationAgentView()` snapshots still replace incremental live
  records when the backend conversation route returns `agentView`.
- No component card-tree scan, `buildAgentWorkflow()` dependency, alternate
  rail store, or UI fallback was added.
