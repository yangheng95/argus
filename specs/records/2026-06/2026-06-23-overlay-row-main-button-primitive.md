# Overlay Row Main Button Primitive

Date: 2026-06-23

GUI means Graphical User Interface. DOM means Document Object Model. ARIA means Accessible Rich Internet Applications. CWD means Current Working Directory.

## Recall

| Source                                                    | Relevant constraint                                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-18-memory-row-nested-interactions.md`            | `.knowledge-item-main` is the Memory row disclosure button; Delete remains a sibling `Button`.                                 |
| `2026-06-20-memory-panel-owner-browser-coverage.md`       | `surfaces/settings.css` owns Memory row internals for Settings and compact left-panel mounts.                                  |
| `2026-06-19-task-dirbar-recent-popover-semantics.md`      | CWD recent/discovered choices are normal row buttons inside `role="list"` containers, not Kobalte menu items.                  |
| `2026-06-18-recent-directory-actions-button-primitive.md` | Recent-directory submit/remove controls already route through the shared `Button` primitive.                                   |
| `packages/overlay/src/components/ui/Button.tsx`           | `Button` is the shared native button wrapper and owns `.oc-button`, variant, size, tone, disabled, and focus-visible defaults. |

## Problem

Independent GUI review found two remaining row-main controls still render raw
`<button>` elements while nearby actions already use `Button`:

- `MemoryPanel.tsx` renders `.knowledge-item-main` as a raw disclosure button.
- `TaskDirBar.tsx` renders discovered and recent `.recent-dir-item` row choices
  as raw buttons.

Both controls duplicate primitive button shell rules in surface CSS. That leaves
two button sources on the same overlay surfaces and makes focus/hover chrome more
likely to drift from the rest of the UI.

## Impact Sweep

| Sweep                                                                           | Result                                                                                               | Decision                                                                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `rg -n "knowledge-item-main                                                     | recent-dir-item                                                                                      | <button                                                                                                                                                         | <Button" packages/overlay/src packages/overlay/test specs` | The live production raw row-main owners are isolated to `MemoryPanel.tsx` and `TaskDirBar.tsx`; tests protect their structure and browser focus paths. | Migrate only those row-main controls in this slice. |
| `packages/overlay/src/styles/surfaces/settings.css`                             | `.knowledge-item-main` hand-maintains reset, layout, and focus rules.                                | Keep the selector as Memory's layout hook, but make the element `.oc-button[data-ui="memory-row-main"]` and express private chrome through primitive variables. |
| `packages/overlay/src/styles/surfaces/conversation.css`                         | `.recent-dir-item` hand-maintains reset, layout, and focus rules.                                    | Keep row sizing/layout under `conversation.css`, but make row choices `.oc-button[data-ui="recent-dir-item"]`.                                                  |
| `task-dirbar-keyboard.test.ts` and `left-tool-panels-directory-browser.test.ts` | Real browser tests already cover recent panel focus/geometry and Memory expand/delete visual states. | Reuse those flows for visual acceptance and add static primitive regression checks.                                                                             |

## Fix Plan

1. Replace `MemoryPanel` raw `.knowledge-item-main` with `Button` using
   `variant="ghost"`, `size="sm"`, `tone="neutral"`, and
   `data-ui="memory-row-main"`.
2. Replace `TaskDirBar` raw `.recent-dir-item` buttons with `Button` using the
   same row-main primitive shape and `data-ui="recent-dir-item"`.
3. Retarget Memory and recent-row CSS to `.oc-button[data-ui="..."]` so the
   shared primitive owns the native button shell while each surface owns only row
   layout, density, and copy truncation.
4. Update static tests to require primitive row-main controls and reject raw row
   button regressions.
5. Run targeted source tests, typecheck, and real browser tests with screenshots.

## Acceptance

- Memory row disclosure remains a native button with `aria-expanded` and
  `aria-controls`, and the Delete action remains a sibling control.
- CWD recent/discovered rows remain focusable row buttons inside `role="list"`
  containers with `aria-current="location"` for the active directory.
- `MemoryPanel.tsx` and `TaskDirBar.tsx` no longer contain raw row-main
  `<button>` elements for `.knowledge-item-main` or `.recent-dir-item`.
- Surface CSS keeps row layout and density while using `.oc-button[data-ui]`
  selectors for primitive-specific chrome.
- Browser screenshots confirm Memory and CWD recent-row focus/hover geometry
  remains visually coherent.
