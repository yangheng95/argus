# Memory Row Nested Interaction Cleanup

Date: 2026-06-18

DOM means Document Object Model. UI means User Interface.

## Problem

`MemoryPanel` renders each `.knowledge-item` as `div role="button"` with
`tabIndex={0}`, while the same row contains a real Delete `Button`. That creates
a nested interactive structure: the row is exposed as one button and the delete
action is exposed as another control inside it.

Two independent GUI agents reported the same issue. It matches the ledger-row
problem already fixed by `2026-06-18-ledger-row-nested-interactions.md`.

## Recall

| Source                                                   | Relevant constraint                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-ledger-row-nested-interactions.md`           | Row containers must not be keyboard buttons when they contain sibling action buttons; the main row button owns selection. |
| `2026-06-18-retire-settings-extension-memory-residue.md` | Live memory row contracts are `.knowledge-item*` and `data-action="delete-memory"`.                                       |
| `MemoryPanel.tsx`                                        | The panel is mounted both in Settings and the left activity tool panel, so both surfaces need the same DOM contract.      |

## Impact Sweep

| Sweep                                               | Result                                                                                                                     | Decision                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `rg -n 'knowledge-item                              | delete-memory                                                                                                              | MemoryPanel                                                                                            | role="button"' packages/overlay/src packages/overlay/test specs/new-arch` | Only `MemoryPanel.tsx` creates `.knowledge-item` rows and nests the delete Button under the row button semantics. | Fix `MemoryPanel` directly; do not create a second row primitive for this narrow case. |
| `packages/overlay/src/styles/surfaces/settings.css` | Settings surface owns `.knowledge-item`, `.knowledge-item-main`, `.knowledge-item-meta-row`, and the delete button sizing. | Add a `.knowledge-item-row` layout wrapper and make `.knowledge-item-main` a button-reset row control. |
| `packages/overlay/src/styles/surfaces/activity.css` | The left side activity panel overrides memory row density.                                                                 | Update the side-panel delete-button selector after the DOM split.                                      |

## Fix

- Keep `.knowledge-item` as a non-semantic row container with state/data hooks.
- Render `.knowledge-item-main` as the native disclosure button for expanding
  inline detail.
- Keep `Button[data-action="delete-memory"]` as a sibling action control.
- Move `.memory-inline-detail` outside the disclosure button.
- Add source and browser tests for the non-nested DOM and keyboard focus path.

## Acceptance

- `.knowledge-item` has no `role="button"` or `tabIndex={0}`.
- `.knowledge-item-main` is a native button with `aria-expanded`.
- Delete `Button[data-action="delete-memory"]` is not inside
  `.knowledge-item-main`.
- Left Memory panel keyboard flow can focus the main button, expand with Enter,
  then Tab to the sibling Delete button.
- Browser screenshot confirms the expanded row remains visually coherent.
