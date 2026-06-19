# Mission Rename Input Single Source

## Problem

Mission ledger rename mode uses a private input class and CSS rule:

| Source | Evidence |
| --- | --- |
| `packages/overlay/src/components/MissionList.tsx` | Rename editor renders `class="mission-row-rename-input"` with `data-ui="mission-row-rename-input"`. |
| `packages/overlay/src/styles/surfaces/mission.css` | `.mission-row-rename-input` duplicates width, border, background, padding, and font styling. |
| `packages/overlay/src/styles/surfaces/sidebar.css` | `.task-row-rename-input` is already the shared ledger row rename input style and owns `:focus-visible`. |
| `packages/overlay/src/components/TaskList.tsx` / `CodingAssistantSessionList.tsx` | Task and Coding Assistant rename editors already use `class="task-row-rename-input"`. |

The Mission editor is the same ledger-row rename surface, so keeping its
private class leaves focus, contrast, and density fixes split across two CSS
owners.

## Recall

| Search | Result |
| --- | --- |
| `rg "mission-row-rename-input|task-row-rename-input|rename-input" packages/overlay/src packages/overlay/test specs/new-arch` | Mission private selector appears only in `MissionList.tsx` and `mission.css`; shared selector appears in Task/Coding Assistant rows and browser token-closure coverage. |
| `MissionList.tsx` worktree diff | File currently has unrelated Mission download work in progress; this fix must only change the rename input class. |
| `mission-launcher-component.test.ts` | Existing Mission ledger static coverage checks task-row action parity, but not rename input parity. |
| `ledger-row-interactions.test.ts` | Existing browser fixture can be extended with an editing Mission row and screenshot evidence. |

## Fix Plan

1. Change Mission rename input to `class="task-row-rename-input"` while keeping
   `data-ui="mission-row-rename-input"` as the semantic hook.
2. Delete `.mission-row-rename-input` from `mission.css`; Mission then inherits
   shared `sidebar.css` focus-visible behavior.
3. Extend static tests to reject the private class/CSS selector.
4. Extend browser ledger-row interactions fixture with a Mission rename input
   focused screenshot and assertions for shared class/focus style.

## Acceptance

- `MissionList.tsx` no longer emits `class="mission-row-rename-input"`.
- `mission.css` no longer defines `.mission-row-rename-input`.
- Mission rename input uses `.task-row-rename-input` and keeps
  `data-ui="mission-row-rename-input"`.
- Browser screenshot confirms the focused Mission rename input uses the shared
  visible focus ring.
