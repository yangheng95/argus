# Right Inspector Activity Expand — 2026-06-06

## Problem

The overlay right panel defaults to `rightPanelCollapsed=true`. In that state the `.sections` container stays mounted as a narrow activity rail and `.sections .side-panel-content` is hidden by CSS. Clicking the right Inspector activity only changes `rightActivity` and `chatView`; it does not expand the right panel. The result is a selected Inspector icon with no visible Inspector content.

## Call Points

| Area                     | File                                                                           | Decision                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Right activity selection | `packages/overlay/src/main.tsx` `selectRightActivity()`                        | Expand the right panel through the existing settings store before showing the selected activity. |
| Right collapse source    | `packages/overlay/src/store/settings.ts` `rightPanelCollapsed`                 | Keep as the single persisted source. No parallel UI state.                                       |
| Persistence              | `packages/overlay/src/services/overlay-settings-storage.ts` / `saveSettings()` | Reuse existing save path so the next overlay load keeps the expanded panel.                      |
| Collapse control         | `packages/overlay/src/components/PanelHeaderCollapseControl.tsx`               | Keep the explicit header rail button as the manual collapse/expand control.                      |
| CSS visibility           | `packages/overlay/src/styles/surfaces/activity.css` and `inspector.css`        | Keep collapse CSS unchanged; the bug is the activity handler not opening the panel.              |
| Regression test          | `packages/overlay/test/side-activity-toolbar-browser.test.ts`                  | Add a browser test for default-collapsed right panel plus Inspector activity click.              |

## Implementation

Selecting any right activity opens the right panel when it is collapsed. This matches the activity rail contract: the rail is a surface selector, not a no-op when the pane is collapsed. The fix does not add fallback rendering, duplicate state, or a temporary preview path.

## Verification

- `bun test packages/overlay/test/side-activity-toolbar-browser.test.ts`
