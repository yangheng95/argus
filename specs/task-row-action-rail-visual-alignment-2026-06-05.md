# Task Row Action Rail Visual Alignment 2026-06-05

## Problem

The sidebar task-row action buttons look visually mismatched when revealed on row hover. The root cause is in the task-row action rail, not in each individual task action:

- `TaskList.tsx` renders delete, cancel, start-now, download, and rename through the shared `Button` primitive.
- `button.css` gives generic icon actions a visible inset shell and sizes direct child SVG icons through `.oc-button > svg`.
- `DeleteButton` and `CancelButton` wrap their icons in spans for two-step confirmation, so their SVGs keep the explicit `Icon size={11}`.
- `StartNowButton`, `DownloadProjectButton`, and `RenameButton` render `Icon` directly, so the generic `.oc-button > svg` rule makes them larger than the confirm buttons.
- `sidebar.css` then compresses all five actions into task-row-local 20px buttons while retaining the generic icon-action shadow unless explicitly overridden.

## Full-Repository Call Points

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/overlay/src/components/TaskList.tsx` action components | `DeleteButton`, `CancelButton`, `RenameButton`, `StartNowButton`, `DownloadProjectButton` all use `Button` with `data-chrome="icon-action"` and task-row `data-ui` values. | Keep the shared primitive. Update only stale width comment, no new component. |
| `packages/overlay/src/styles/surfaces/sidebar.css` action rail | `.task-row-actions` and grouped `.task-row-actions .oc-button[data-ui="..."]` own task-row-local sizing and visibility. | Make this the single source for task-row action icon size, shell, gap, and semantic hover colors. |
| `packages/overlay/src/styles/primitives/button.css` icon-action primitive | Generic `data-chrome="icon-action"` is used by composer, file explorer, notifications, mission list, TUI host, provider panel, and task list. | Do not weaken the primitive globally; other surfaces rely on visible resting icon action chrome. |
| `packages/overlay/test/task-row-actions-hover-only.test.ts` | Pins hidden-at-rest reveal selectors. | Extend coverage to download and unified visual token. |
| `packages/overlay/test/task-row-right-alignment.test.ts` | Pins action slot width and right-column geometry. | Update expected width to current five-action rail width. |
| `packages/overlay/test/icon-affordance-visibility.test.ts` | Pins task-row hover-only exception to the generic visible icon-action shell. | Add explicit no-shadow and normalized icon-size assertions. |
| `packages/overlay/test/task-list-buttons-primitive.test.ts` | Pins task row controls route through `Button`. | Keep passing; no separate action button class. |
| `packages/overlay/test/hover-action-geometry.test.ts` | Playwright fixture validates action rail does not overlap text. | Keep as visual geometry guard; run targeted test after CSS changes. |

## Implementation

Use `sidebar.css` to define a task-row-local action rail:

- Five actions fit the existing dedicated action slot.
- Resting action buttons are hidden and pointer-disabled.
- Visible buttons share one height, width, border radius, no inset shadow, and one SVG size.
- Hover/focus uses a restrained background plus semantic foreground color per action type.

## Verification

Run targeted overlay tests for task row action CSS contracts and Playwright geometry, then run overlay typecheck/build if the focused tests pass.
