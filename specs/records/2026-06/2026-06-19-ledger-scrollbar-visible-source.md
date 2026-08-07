# Ledger Scrollbar Visible Source

## Problem

The global cascade hides scrollbar chrome by default. `#taskListPanel` and `#chatScroll` opt back into the visible scrollbar contract, but the live Mission and Coding Assistant ledger containers do not.

That makes long Mission and Coding Assistant ledgers scrollable without a visible position indicator, while the same left-rail task list shows one.

## Recall

- `packages/overlay/src/styles/cascade/base.css` is the single visible-scrollbar whitelist for global scrollers.
- `packages/overlay/src/styles/surfaces/mission.css` defines `.mission-ledger-list` as the Mission ledger `overflow-y: auto` container.
- `packages/overlay/src/styles/surfaces/coding-assistant.css` defines `.coding-assistant-ledger-list` as the Coding Assistant ledger `overflow-y: auto` container.
- `packages/overlay/src/components/MissionList.tsx` and `packages/overlay/src/components/CodingAssistantSessionList.tsx` render those classes in production.
- `packages/overlay/src/index.html` gives the Task list `#taskListPanel` a visible scrollbar via the existing whitelist, so the three left-ledger surfaces should share the same source.

## Impact Search

| Search                                                                                           | Result                                                               |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------- | ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `rg -n "mission-ledger-list                                                                      | coding-assistant-ledger-list                                         | #taskListPanel      | #chatScroll                  | scrollbar-width:\\s\*auto | session-scrollbar-size" packages/overlay/src/styles packages/overlay/src/components packages/overlay/test specs -g "_.css" -g "_.tsx" -g "_.ts" -g "_.md"` | `base.css` only whitelists `#chatScroll` / `#taskListPanel`; Mission and Assistant ledger lists are live scrollers. |
| `rg -n "ledger.\*scrollbar                                                                       | scrollbar.\*ledger                                                   | mission-ledger-list | coding-assistant-ledger-list | left activity.\*scrollbar | activity._scrollbar" specs packages/overlay/test packages/overlay/src -g "_.md" -g "_.ts" -g "_.tsx" -g "\*.css"`                                          | No existing active ledger scrollbar fix record.                                                                     |
| `rg -n -F "mission-conversation-body" packages/overlay/src packages/overlay/test specs` | Old Mission conversation selector is retired and must not be reused. |

## Fix Plan

1. Add `.mission-ledger-list` and `.coding-assistant-ledger-list` to the existing `base.css` visible-scrollbar whitelist.
2. Update the whitelist comment so the documented primary content lists match live DOM owners.
3. Add a focused CSS source test proving all four live scrollers share `scrollbar-width: auto`, the webkit width token, track token, thumb token, and hover token from the same rule group.
4. Keep the retired `.mission-conversation-body` guard unchanged.

## Verification

- `bun test packages/overlay/test/visible-scrollbar-whitelist.test.ts packages/overlay/test/retire-overlay-orphan-css-residue.test.ts packages/overlay/test/css-structural-validity.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-concurrency=1 packages/overlay/test/browser/ledger-scrollbar-browser.test.ts`
