# Panel Header Collapse CSS Retirement

Date: 2026-06-17

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

The overlay no longer mounts `PanelHeaderCollapseControl`, but active surface
CSS still exposes `.panel-header-collapse-mount` and
`.sections-header-actions` rules. Those selectors make a removed header
collapse affordance look like a current UI contract.

## Call Points

| Search                                                                           | Evidence                                                           | Decision                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `rg -n "sections-header-actions                                                  | panel-header-collapse-mount                                        | PanelHeaderCollapseControl                                                                      | sidebar-header-collapse-toggle | right-panel-header-collapse-toggle" packages/overlay/src packages/overlay/test specs` | The collapse component source is gone. Collapse toggle IDs only remain in browser tests that assert absence. The two class names only appear in active CSS and historical docs. | Delete the active CSS rules for the removed mounts. |
| `specs/records/2026-06/2026-06-09-task-panel-collapse-removal-mission-header-parity.md` | The left task panel collapse affordance was intentionally removed. | Do not reintroduce sidebar collapse styling.                                                    |
| `specs/records/2026-06/2026-06-11-center-workbench-header-alignment.md`                 | Current headers use `SurfaceHeader` as the single primitive.       | Keep `.sections-header` and `.oc-surface-header__actions`; remove only retired mount selectors. |

## Fix Shape

- Remove `.panel-header-collapse-mount` rules from `header.css`,
  `activity.css`, `inspector.css`, and `sidebar.css`.
- Remove `.sections-header-actions.oc-surface-header__actions` from
  `header.css`.
- Add a static surface-header regression test so the removed selectors cannot
  re-enter active CSS.

## Verification

- `bun test packages/overlay/test/surface-header-primitive.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Browser smoke and screenshots of representative headers after the deletion.
