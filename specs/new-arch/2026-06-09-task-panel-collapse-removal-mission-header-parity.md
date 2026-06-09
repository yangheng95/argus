# Task Panel Collapse Removal + Mission Header Parity — 2026-06-09

## Evidence

User screenshot shows the Task sidebar header as the visual source of truth:

| Surface                       | Current owner                                                                                                                                                                                        | Decision                                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task sidebar collapse control | `packages/overlay/src/index.html` placeholders `solidLeftPanelCollapseControl` / `solidLeftCollapsedRailControl`, mounted from `packages/overlay/src/main.tsx` via `LeftPanelHeaderCollapseControl`. | Remove the Task sidebar collapse affordance and force the left sidebar expanded at runtime so stale persisted collapsed state cannot strand the panel. |
| Task header action style      | `packages/overlay/src/index.html` `sidebar-mission-button` + `sidebar-new-task-button`, styled by `packages/overlay/src/styles/surfaces/sidebar.css`.                                                | Keep the existing Task action primitives as the source.                                                                                                |
| Mission ledger header         | `packages/overlay/src/components/MissionList.tsx` and `packages/overlay/src/styles/surfaces/mission.css`.                                                                                            | Match Task header action sizing: text-only Task back action and solid accent new action, with the same icon span hook and search spacing.              |

## Call Points

Full-repo grep targets checked before editing:

| Target                                                            | Call points                                                                                                                                                                | Action                                                                                                       |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `LeftPanelHeaderCollapseControl`                                  | `packages/overlay/src/main.tsx`, `packages/overlay/src/components/PanelHeaderCollapseControl.tsx`                                                                          | Remove the left sidebar mount. Leave the component file untouched until no other pending work depends on it. |
| `sidebar-header-collapse-toggle`                                  | `packages/overlay/src/components/PanelHeaderCollapseControl.tsx`, `packages/overlay/test/pane-collapse-layout.test.ts`, `packages/overlay/test/pane-collapse-rail.test.ts` | Update tests to assert absence from the Task panel.                                                          |
| `solidLeftPanelCollapseControl` / `solidLeftCollapsedRailControl` | `packages/overlay/src/index.html`, `packages/overlay/src/main.tsx`, `packages/overlay/test/acceptance-panel-mount.test.ts`                                                 | Remove DOM placeholders and mount code; update structural tests.                                             |
| `mission-back-panel` / `mission-new`                              | `packages/overlay/src/components/MissionList.tsx`, `packages/overlay/test/mission-launcher-component.test.ts`                                                              | Align button variants/sizes with Task panel; keep existing data hooks.                                       |
| `mission-ledger-search`                                           | `packages/overlay/src/styles/surfaces/mission.css`                                                                                                                         | Match Task list search spacing and input density.                                                            |

## Validation

- Run focused overlay tests covering Mission header structure and left panel collapse removal.
- Run overlay typecheck if focused tests pass.
