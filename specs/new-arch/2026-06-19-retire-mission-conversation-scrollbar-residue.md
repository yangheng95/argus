# Retire Mission Conversation Scrollbar Residue

## Problem

`packages/overlay/src/styles/cascade/base.css` still opts `.mission-conversation-body` into the global visible-scrollbar whitelist. That selector belonged to the retired Mission-local conversation shell. Current Mission behavior routes selected sessions through the shared center `Conversation` mounted in `#chatScroll`, so the class has no production DOM owner.

Leaving the selector in the global scrollbar whitelist creates a false style source for a surface the product no longer renders.

## Recall

- `specs/new-arch/2026-06-05-mission-workbench-task-parity.md` added `.mission-conversation-body` when Mission still owned a local conversation body.
- `specs/new-arch/2026-06-11-mission-left-activity-retire-panel.md` later deleted the Mission-local conversation shell and moved session rendering to the shared center chat.
- Current tests already assert `Mission.tsx` no longer contains `MissionConversation`, `data-ui="mission-conversation"`, or a Mission-local `<Conversation>`.

## Impact Search

| Search | Result |
| --- | --- |
| `rg -n -F "mission-conversation-body" packages/overlay/src packages/overlay/test specs/new-arch` | Only `base.css` and old `2026-06-05` spec. |
| `rg -n -F "MissionConversation" packages/overlay/src packages/overlay/test specs/new-arch` | Current source has no owner; tests assert it is absent. |
| `rg -n -F "mission-conversation" packages/overlay/src packages/overlay/test specs/new-arch` | Only `base.css`, old spec, and absence tests. |
| `rg -n -F "chat-scroll" packages/overlay/src packages/overlay/test specs/new-arch` | Shared center chat remains owned by `#chatScroll` / `.chat-scroll`. |

## Fix Plan

1. Remove `.mission-conversation-body` from the global visible-scrollbar whitelist in `base.css`.
2. Update the scrollbar comment so the documented opt-ins match the live selectors.
3. Add `mission-conversation-body` to the retired orphan CSS residue guard.

## Verification

- `bun test packages/overlay/test/retire-overlay-orphan-css-residue.test.ts packages/overlay/test/styles-no-dangling-selectors.test.ts packages/overlay/test/css-structural-validity.test.ts packages/overlay/test/mission-html-entry.test.ts packages/overlay/test/mission-session-source.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser Mission/workspace chrome smoke to confirm the live shared center chat still owns the visible scrollbar surface.
