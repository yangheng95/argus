# Armed Confirm Button A11y Single Source

Date: 2026-06-20

## Problem

Independent GUI review found that destructive inline ledger actions expose their
armed confirmation state only through visual styling:

| Surface | Existing source | Problem |
| --- | --- | --- |
| Task row delete/cancel | `packages/overlay/src/components/TaskList.tsx` | Direct `useArmedConfirm`; `data-confirm` changes icon/color, but the accessible name and button state stay static. |
| Mission abort/delete | `packages/overlay/src/components/MissionList.tsx` | Same direct hook and visual-only armed state. |
| Coding Assistant stop/delete | `packages/overlay/src/components/CodingAssistantSessionList.tsx` | Same direct hook and visual-only armed state. |

The low-level `Button` primitive is already reused, so the root issue is not a
raw button. The missing owner is a reusable destructive-confirm action primitive
that couples the shared armed timer with accessible state.

## Full Call-Site Inventory

`rg -n "useArmedConfirm|data-confirm|aria-pressed|ArmedConfirm" packages/overlay/src packages/overlay/test`

| Call site | Decision |
| --- | --- |
| `packages/overlay/src/solid/armed-confirm.ts` | Keep as the low-level timer primitive. |
| `packages/overlay/src/components/TaskList.tsx` | Replace direct `useArmedConfirm` usage with shared `ArmedConfirmButton`. |
| `packages/overlay/src/components/MissionList.tsx` | Replace direct `useArmedConfirm` usage with shared `ArmedConfirmButton`; preserve existing uncommitted mission download additions. |
| `packages/overlay/src/components/CodingAssistantSessionList.tsx` | Replace direct `useArmedConfirm` usage with shared `ArmedConfirmButton`. |
| `packages/overlay/src/styles/surfaces/sidebar.css` | Keep existing `data-confirm` visual styling; the shared primitive continues to emit `data-confirm`. |
| Browser tests using `[data-confirm="true"]` | Extend relevant flows to assert `aria-pressed`, `aria-describedby`, live/status text, and visual screenshots. |
| Static adoption tests | Update so ledger components cannot import `useArmedConfirm` directly. |

## Design

Add `packages/overlay/src/components/ui/ArmedConfirmButton.tsx`:

- Uses the existing `Button` primitive for DOM and visual button semantics.
- Uses `useArmedConfirm` as the single timer/state primitive.
- Emits `data-confirm="true"` for existing CSS.
- Emits `aria-pressed="true|false"` because the button enters a temporary armed state.
- Emits `aria-describedby` while armed, pointing at a hidden status node inside the button.
- The hidden status node has `role="status"` and `aria-live="polite"` so the first click announces the confirmation instruction.
- The action commits only on the second activation within the confirm window.
- Blur disarms using the existing hook semantics.

Text stays in i18n:

- `armed_confirm.task.cancel`
- `armed_confirm.task.delete`
- `armed_confirm.mission.abort`
- `armed_confirm.mission.delete`
- `armed_confirm.coding_assistant.stop`
- `armed_confirm.coding_assistant.delete`

No new visual colors or token systems are required. The only new CSS is hidden
text geometry in `button.css`, using the same 1px clipping pattern already used
by sidebar hidden labels.

## Tests

- Update `solid-armed-confirm.test.ts` adoption checks: direct
  `useArmedConfirm(` is allowed only in the shared primitive and the hook test.
- Update static primitive tests for Task, Mission, and Coding Assistant ledgers
  to require `ArmedConfirmButton`.
- Extend real browser flows:
  - Task cancel first-click state in `task-list-tree-click.test.ts`.
  - Mission abort first-click state in `side-activity-toolbar-browser.test.ts`.
  - Coding Assistant stop/delete first-click states in
    `side-activity-toolbar-browser.test.ts`.
- Screenshots are captured after first click so the visual `data-confirm` state
  is reviewed together with the accessibility assertions.

## Non-goals

- Do not change confirmation timing.
- Do not replace unrelated rename/download/start buttons.
- Do not alter mission download changes already present in the working tree.
