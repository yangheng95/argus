# Agent Rail Visibility Regression

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- SSE: Server-Sent Events, the selected task/session live-update stream.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Investigate and fix the user-visible regression where the Conversation agent
rail is no longer visible. Preserve the current single-source rail design:
production rail records come from `conversation-agents.ts` hydrated from the
backend `agentView`, not from a component-level card-tree fallback scan.

## Recall

| Source                                                   | Constraint carried forward                                                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                              | No fallback, no double source, recall disk plans before edits, test every change, visually verify UI work, do not restart the live overlay process without explicit user confirmation. |
| `2026-05-13-conversation-agent-workflow-rail.md`         | The rail is an independent Conversation-owned bottom strip; empty rail should not reserve height.                                                                                      |
| `2026-06-10-agent-rail-identity-empty-card-fix.md`       | Lifecycle-only sessions must not create blank cards or rail records; message-backed or goal-phase records are the canonical display records.                                           |
| `2026-06-20-agent-rail-drag-scroll-regression.md`        | Browser validation must use a real browser and screenshot evidence for the rail.                                                                                                       |
| `2026-06-23-overlay-conversation-render-backpressure.md` | The live rail source is `conversationAgentStore.records`; do not restore `buildAgentWorkflow()` or card-tree scans in the mounted rail.                                                |
| `2026-06-23-conversation-agent-rail-pointer-capture.md`  | `attachRailDragScroll` remains the single drag-scroll owner.                                                                                                                           |

## Call Point Inventory

| Surface                                          | Evidence                                                                                              | Decision                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `App.tsx`                                        | `StaticMountPortal id="solidConversationAgentRailMount"` still renders `<ConversationAgentRail />`.   | Keep global owner in `App`; do not remount from `main.tsx`.                                                     |
| `index.html`                                     | `solidConversationAgentRailMount` is still below `conversationBody` inside `chatMessagePane`.         | Keep Conversation bottom-strip placement.                                                                       |
| `ConversationAgentRail.tsx`                      | Rail hides via `<Show when={records().length > 0}>`.                                                  | Preserve empty hidden behavior; any visibility fix must ensure real records exist or fix legal layout clipping. |
| `conversation-agents.ts`                         | Store is keyed by `task:<id>` / `session:<id>`.                                                       | Keep one store source; add coverage for task and session hydration if needed.                                   |
| `events.ts`                                      | `message.*` SSE writes card tree; `task.messages.changed` schedules `mergeLatestConversationTail()`.  | Rail freshness must be verified through tail merge, not component fallback.                                     |
| `conversation-agent-rail-scroll-browser.test.ts` | Existing visual test waited for a task row that is hidden while Mission is the default left activity. | Update the browser path to use the visible Tasks activity before selecting the task.                            |

## Working Root Cause Hypotheses

1. The current browser rail test is stale after the left activity default moved
   to Mission: the task row exists but is hidden, so the test never reaches the
   rail.
2. The production rail can still disappear if `agentView` hydration does not
   update `conversationAgentStore` for the selected source after a
   `task.messages.changed` tail merge.
3. Layout clipping is less likely because the host, rail, and lane CSS still
   reserve a 42px bottom strip only when the Solid component renders records.

## Fix Plan

1. Add/extend focused tests proving tail-merge hydration updates
   `conversationAgentStore` with message-backed records.
2. Update the rail browser test to enter the real Tasks activity before
   selecting the fixture task, then assert rail visibility and capture the
   screenshot.
3. If the new tests expose a real store update bug, fix it in
   `conversation-agents.ts` / `conversation.ts` while preserving the
   single-source `agentView` design.
4. Run focused unit tests, the real browser rail test, inspect the screenshot,
   self-review, commit, and push.

## Acceptance

- Rail is visible in an isolated real-browser task fixture with message-backed
  agent records.
- `task.messages.changed` tail merge produces rail records for the selected
  task without resetting the card tree.
- No component-level `buildAgentWorkflow()` fallback, card-tree scan, duplicate
  rail owner, or document-level drag listener is introduced.
- The browser visual artifact shows the bottom strip present and unclipped.

## Verification

- PASS: `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/acceptance-panel-mount.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `git diff --check`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`.

## Visual QA

- Reviewed `.scratch/conversation-agent-rail-scroll-browser/rail-after-drag.png`.
  The task rail is visible as a horizontal 42px strip with multiple avatar
  buttons and no clipping.
- Reviewed `.scratch/conversation-agent-rail-scroll-browser/rail-coding-assistant.png`.
  The coding-assistant session rail is visible with a message-backed avatar
  button and non-zero strip dimensions.

## Self Review

- No mounted rail fallback was added: `ConversationAgentRail` still reads only
  `conversationAgentRecordsForSource(boardStore.selectedSource)`.
- The new selected-task test proves `task.messages.changed` tail merge updates
  `conversationAgentStore.records`, preventing card-tree-only visibility.
- The browser test now enters the real Tasks activity before selecting a task
  and also covers a coding-assistant session source, which is the scenario that
  exposed the 0-size rail regression.
