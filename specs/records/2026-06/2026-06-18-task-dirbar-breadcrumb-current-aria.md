# TaskDirBar Breadcrumb Current ARIA

Date: 2026-06-18

## Problem

The Current Working Directory breadcrumb marked the last path segment with
`.task-dir-node[data-current="true"]`, and CSS used that attribute for the
visible current-location highlight. When host capabilities allowed directory
opening, the same current segment rendered as a focusable button, but it did not
expose an equivalent current-location state to assistive technologies.

## Recall

| Source                                               | Relevant decision                                                                                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-task-dirbar-recent-trigger-semantics.md` | `pathBreadcrumb()` is the single source for native breadcrumb buttons; it must not be converted into menu markup or duplicated in `TaskDirBar`. |
| `2026-06-18-task-dirbar-current-location-aria.md`    | Current directory commands use `aria-current="location"` and must not use `aria-selected` or `aria-pressed`.                                    |
| `2026-06-18-file-explorer-row-button-semantics.md`   | Visual current state on a command button must be mirrored onto the same focusable control.                                                      |

## Impact Sweep

| Sweep                                                        | Result                                                                                      | Decision                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------ | ------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `rg -n 'pathBreadcrumb\(                                     | task-dir-node                                                                               | data-current                                             | aria-current | aria-selected | aria-pressed' packages/overlay/src packages/overlay/test specs` | `dom-utils.ts::pathBreadcrumb()` was the only runtime source for `.task-dir-node[data-current="true"]`; no existing breadcrumb test asserted current ARIA. | Fix `pathBreadcrumb()` and add direct unit coverage. |
| `packages/overlay/src/styles/surfaces/conversation.css`      | `.task-dir-node[data-current="true"]` owns the visible current segment styling.             | Preserve the visual hook and add semantics beside it.    |
| `packages/overlay/test/browser/task-dirbar-keyboard.test.ts` | The real browser flow already renders the cwd breadcrumb and saves a TaskDirBar screenshot. | Extend it to verify the live current breadcrumb segment. |

## Fix

`pathBreadcrumb()` now emits `aria-current="location"` on the same current
segment that owns `data-current="true"`, for both host-supported button nodes
and unsupported static span nodes.

The breadcrumb remains a set of native buttons/spans. It does not become a
listbox, radio group, tree, or toggle surface.

## Acceptance

- Current breadcrumb segment has both `data-current="true"` and
  `aria-current="location"`.
- Non-current breadcrumb segments omit `aria-current`.
- Breadcrumb nodes do not use `aria-selected` or `aria-pressed`.
- The existing TaskDirBar browser screenshot remains visually unchanged.
