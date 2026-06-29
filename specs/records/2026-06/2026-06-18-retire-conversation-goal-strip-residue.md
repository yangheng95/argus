# Retire Conversation Goal Strip Residue

Date: 2026-06-18

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

The active conversation goal progress UI is the Solid `TaskProgressBar` mounted
inside `Conversation.tsx`, with visual ownership in `card.css` through
`.task-progress*` and `.task-progress__pill`. The older static
`#chatGoalsStrip` and `.goal-chip` surface still existed in `index.html`,
`dom.ts`, `conversation.css`, and tests even though it was empty and never
populated.

The same sweep found retired task strip children (`.task-bar-main`,
`.task-cwd-actions`, `.task-flag`) and `.chat-follow-label` preserved only by
CSS and tests. Keeping these selectors creates a second task/goal UI contract
beside the live TaskProgressBar and current task directory shell.

## Recall

| Source                                                 | Existing decision                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `mission-panel-parity-2026-05-29.md`                   | `#chatGoalsStrip` is a dead stub; goal progress is `TaskProgressBar` inside `Conversation`.               |
| `2026-05-13-conversation-agent-workflow-rail.md`       | `chatScroll` remains the only message scroll container; auxiliary rails mount outside the message stream. |
| `2026-06-04-agent-rail-card-scroll-materialization.md` | `TaskProgressBar` uses the same card-scroll request path as the agent rail.                               |

## Impact Sweep

| Sweep                  | Result           |
| ---------------------- | ---------------- | --------- | ------------- | ---------------- | --------- | ----------------- | --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "chatGoalsStrip | chat-goals-strip | goal-chip | task-bar-main | task-cwd-actions | task-flag | chat-follow-label | TaskProgressBar | task-progress\_\_pill" packages/overlay/src packages/overlay/test specs` | Retired selectors were static HTML/CSS/test-only. `Conversation.tsx` renders `TaskProgressBar`, and `card.css` owns `.task-progress__pill`. |

## Fix

- Remove the static `#chatGoalsStrip` DOM and `dom.ts` lookup.
- Delete `.chat-goals-strip`, `.goal-chip*`, `.chat-follow-label`,
  `.task-bar-main`, `.task-cwd-actions`, and `.task-flag*`.
- Remove the stale `.task-flag` settings comment reference.
- Convert architecture and owner-surface tests to reject the retired selectors
  while preserving `TaskProgressBar`/`.task-progress__pill` checks.

## Acceptance

- Production source has no retired conversation goal/task strip selector hits.
- `Conversation.tsx` still renders `TaskProgressBar`, and `card.css` still owns
  `.task-progress__pill`.
- Targeted unit tests, browser visual verification, typecheck, docs check, and
  diff checks pass.
