# Right Activity Toolbar Responsive Rail

Date: 2026-06-18

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

The right activity toolbar is the last child of `#workspaceMain`. At the desktop
layout it is a vertical rail beside the workbench. At `max-width: 1120px`,
`#workspaceMain` changes to a column layout, but the right rail kept its
vertical toolbar internals. The flex item became only one rail-height tall while
seven right activity buttons still stacked vertically, so later buttons were
clipped by the workspace container and could not be hit-tested.

## Recall

| Source                                                   | Existing decision                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `2026-06-05-vscode-style-activity-toolbars.md`           | Left and right side navigation must use the shared `SideActivityToolbar` primitive, not alternate toolbar sources.   |
| `2026-06-17-center-workbench-separator-accessibility.md` | Responsive workbench geometry belongs to the real workbench and toolbar DOM, not pseudo or hidden fallback controls. |
| `2026-06-17-left-pane-resizer-accessibility.md`          | Responsive pane geometry must expose the actual reachable layout state.                                              |

## Impact Sweep

| Sweep                                       | Result                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rg -n "solidRightActivityToolbar           | side-activity-toolbar                                                                                                                                   | @media \\(max-width: 1120px\\)" packages/overlay/src/styles packages/overlay/src/index.html packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | The right toolbar has one live mount and one shared primitive; the responsive breakpoint changes `#workspaceMain` to column but did not change the right toolbar to row. |
| Browser geometry at `960x820` and `390x760` | The toolbar flex item height was around one rail button while all seven right buttons remained vertical; later buttons extended below `#workspaceMain`. |

## Fix

- Keep `SideActivityToolbar` as the only right activity UI source.
- In the `max-width: 1120px` workspace breakpoint, make
  `#solidRightActivityToolbar` a full-width horizontal rail.
- Change the right active indicator from a vertical right-edge bar to a
  bottom-edge bar only in the horizontal responsive rail.
- Extend the browser side activity test so all right activity buttons are
  inside `#workspaceMain` and hit-testable at `960px` and `390px`.

## Acceptance

- Right activity buttons are all visible and hit-testable at desktop, tablet,
  and mobile-width responsive layouts.
- No duplicate or fallback toolbar is introduced.
- Existing right activity selection still routes through the same
  `SideActivityToolbar` and `selectRightActivity` path.
