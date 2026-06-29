# Overlay Conversation Render Backpressure

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- SSE: Server-Sent Events, the selected task live-update stream.

## Task Definition

Fix the overlay freeze observed while a large frontend-design task is open.
The sidecar responds quickly, but the WebView renderer saturates CPU while the
overlay hydrates and updates a large conversation. The fix must reduce
front-end card-tree projection and navigation work without hiding messages,
dropping tool output, adding fallback behavior, or restarting the live overlay
process.

## Recall

| Source                                                     | Constraint carried forward                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                | No fallback, no gate, no blind patching, recall disk plans before edits, test every change, visually verify overlay work, do not restart/refresh live overlay without explicit confirmation.                                                                 |
| `2026-06-23-conversation-hydrate-global-message-budget.md` | Server hydrate payload is globally bounded; remaining freeze is a front-end render/projection problem, not an excuse to add frontend gates.                                                                                                                  |
| `2026-06-22-file-changes-hidden-projection-boundary.md`    | ConversationAgentRail workflow projection is a known remaining pressure source that needs its own benchmark/fix round.                                                                                                                                       |
| Pre-June conversation agent workflow rail record           | Agent rail must keep one workflow projection owner and must not infer a second agent-state source inside the component.                                                                                                                                      |
| This round                                                 | The old `buildAgentWorkflow()` component-source wording is superseded for the live rail. The single rail source is now the server-hydrated `agentView` projected by `conversation-agents.ts`; `buildAgentWorkflow()` remains a pure historical/test utility. |
| `card-tree-stats.ts` parentID contract                     | Tree writer already maintains `CardNode.parentID` when `childIDs` edges change; render-side parent lookup must consume that source instead of scanning all cards.                                                                                            |

## Call Point Inventory

| Surface                                       | Evidence                                                                                                    | Decision                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Conversation.tsx::topLevelIDForCard`         | Scans `Object.values(cardTreeStore.cards).find(card.childIDs.includes(current))` for every parent step.     | Replace with a shared parentID-chain helper.                                                                            |
| `ConversationAgentRail.tsx::parentIDsForCard` | Duplicates the same full-card scan.                                                                         | Replace with the same shared parentID-chain helper.                                                                     |
| `card-tree-stats.ts`                          | `linkChildToParent()` / `unlinkChildFromParent()` keep `parentID` current during writer hierarchy rebuilds. | Keep this as the single parent source; do not add a second reverse index.                                               |
| `ConversationAgentRail.tsx::projection`       | Always runs `buildAgentWorkflow({ cards, order: orderedReachableCardIDs() })` and merges hydrated records.  | Use hydrated `conversationAgentStore.records` as the task/session rail source; fall back scanning is not allowed.       |
| `conversation-agents.ts`                      | Server hydrate already projects agent records from `agentView.sessions/messages`.                           | Make this the rail's primary source; live updates continue through `hydrateConversationAgentView()` during tail merges. |
| `agent-workflow.ts` tests                     | `buildAgentWorkflow()` remains covered as a pure projection utility.                                        | Keep the utility for explicit callers/tests, but remove always-mounted rail dependency.                                 |
| Browser visual tests                          | Existing rail browser test covers drag/visibility, but not this performance path.                           | Add static and perf tests; run existing rail browser visual check in an isolated runner.                                |

## Root Cause

The current freeze is caused by front-end projection work that scales with the
entire card tree while a large task is active:

1. The always-mounted ConversationAgentRail recomputes a live workflow by
   walking the whole reachable card tree, then merges it with the server
   hydrated `agentView` records. For the observed task, the server is already
   sending a large but bounded agent view, so the extra live scan duplicates
   work on every visible card-tree update.
2. Conversation card navigation still reverse-walks parents by scanning every
   card's `childIDs`, even though tree-writer already maintains `parentID`.
   Pinning, locating rail records, and scroll requests become O(total cards)
   per parent hop.

This is not a backend availability problem: health checks and conversation
routes respond quickly. It is also not solved by hiding output or limiting the
rendered transcript because that would create a second UI truth source.

## Fix Plan

1. Add shared render-side helpers that walk `CardNode.parentID` to return a
   card's ancestor chain and top-level ancestor.
2. Replace the duplicate parent scans in `Conversation` and
   `ConversationAgentRail` with those helpers.
3. Change `ConversationAgentRail` to render the server-hydrated
   `conversationAgentRecordsForSource(boardStore.selectedSource)` directly.
   The rail remains one agent-state source: `conversation-agents.ts`.
4. Add tests rejecting `Object.values(cardTreeStore.cards).find(...)` parent
   scans in these components and proving the helpers do not enumerate all
   cards.
5. Add/update performance coverage for large hydrated conversations so the
   changed path is measurable.
6. Run focused tests, typecheck, isolated browser visual QA, self-review, then
   commit and push only the files changed in this round.

## Acceptance

- Conversation and AgentRail parent navigation use `parentID`, not a full
  `Object.values(cardTreeStore.cards)` reverse scan.
- ConversationAgentRail no longer rebuilds live workflow projection from the
  whole card tree while the server-hydrated agent view is available.
- No fallback workflow source, hidden UI gate, dropped transcript content,
  duplicate parent index, or live overlay process restart is introduced.
- Focused unit/static/perf tests pass.
- Existing rail browser visual QA still shows the strip and interaction
  surface correctly in an isolated test run.
- The diff is self-reviewed after tests pass.

## Verification

- PASS: `bun test packages/overlay/test/card-tree-reachability.test.ts packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/acceptance-panel-mount.test.ts --timeout 30000`.
- PASS: `bun test packages/overlay/test/tree-writer-perf.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`.

## Visual QA

- Reviewed `.scratch/conversation-agent-rail-scroll-browser/rail-after-drag.png`.
- The agent rail is visible after horizontal drag, avatar buttons remain evenly
  spaced, and the strip is not blank, overlapped, or clipped.

## Self Review

- Rechecked `Conversation.tsx`: card scroll and pinning now call
  `topLevelCardIDForCard(cardID, order())` and no longer scan
  `Object.values(cardTreeStore.cards)`.
- Rechecked `ConversationAgentRail.tsx`: records come directly from
  `conversationAgentRecordsForSource(boardStore.selectedSource)`, and parent
  expansion uses `parentIDChainForCard(cardID)`.
- Rechecked live-update ownership: selected task message changes still schedule
  tail merges, and tail merges call `hydrateConversationAgentView()`, so the
  rail source remains live through the existing conversation source.
- Rechecked dead-code risk: `buildAgentWorkflow()` and `mergeAgentRecords()`
  are no longer production rail callers. They were left in place because this
  round did not receive deletion approval for now-test-only historical
  utilities.
