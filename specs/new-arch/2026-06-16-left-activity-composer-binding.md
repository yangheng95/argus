# Left Activity Composer Binding - 2026-06-16

## Problem

The left activity toolbar, left ledger body, center primary panel, and shared
composer can drift apart:

- Clicking New Task resets the center panel but does not select the Tasks left
  activity.
- Clicking New Coding Assistant immediately creates a backend session, so an
  empty row can occupy the Assistant ledger before the operator sends anything.
- The shared composer routes Mission only when `missionLauncherActive()` is
  true; otherwise a blank task target falls through to `panelMessage()` task
  creation. If the toolbar/center state is visually on Mission while the
  launcher bit is stale, the submitted Mission text becomes a Task.
- Assistant row management still uses `coding-assistant-row-delete` /
  `coding-assistant-row-rename` data hooks and custom icon CSS, while Task and
  Mission rows already share `task-row-delete` / `task-row-rename`.

## Call Point Sweep

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/overlay/src/main.tsx::selectLeftActivity` | Owns activity icon selection and center reset for Tasks/Mission/Assistant. | Keep as the user toolbar entry. Add focused launcher helpers for explicit New Task, New Mission, and New Assistant. |
| `packages/overlay/src/main.tsx::openMissionLauncher` | Sets Mission center panel, clears selected source, and sets `missionLauncherActive`. | Keep Mission creation delayed until `wakeMission` submit. |
| `packages/overlay/src/main.tsx::btnCreateTask` | Clears Mission launcher and calls `resetCenterWorkbenchToFocusedPanel("tasks")` but does not set left activity. | Route through a single `openTaskLauncher()` that also selects the Tasks activity. |
| `packages/overlay/src/main.tsx::btnCreateCodingAssistantSession` | Calls `createCodingAssistantSession()` on click. | Replace with `openCodingAssistantLauncher()`: select Chat center, clear source, set an Assistant launcher bit. Create the session only in composer submit. |
| `packages/overlay/src/main.tsx::ChatComposer onSubmit` | Mission branch uses `wakeMission`; all other blank states use `panelMessage`, which creates Tasks. | Add an Assistant launcher branch before `panelMessage`. Mission branch remains the only Mission submission path. |
| `packages/overlay/src/components/CodingAssistantSessionList.tsx` | Action data hooks and icon spans are Assistant-specific. | Reuse Task row `data-ui` values and `task-row-delete-icon` / `task-row-cancel-icon` classes, matching Mission. |
| `packages/overlay/src/styles/surfaces/coding-assistant.css` | Custom action visibility and confirm-icon selectors duplicate Task row CSS. | Delete Assistant-specific row-action CSS after the component uses Task classes. |
| tests | `coding-assistant-panel`, `mission-launcher-component`, `task-row-actions-hover-only`, browser side activity coverage. | Add source-contract tests for delayed Assistant creation and launcher binding; update icon parity assertions. |

## Acceptance

- New Task, New Mission, and New Coding Assistant all select the matching left
  toolbar icon and center primary panel.
- Task-source rebind only applies to primary conversation activities
  (Tasks/Mission/Coding Assistant). Memory, Skill, and MCP remain left tool
  activities over the selected task and must not be forced back to Tasks.
- Clicking New Coding Assistant without submitting does not call
  `createCodingAssistantSession()` and does not add a ledger row.
- Submitting the Assistant launcher first creates a Coding Assistant session,
  selects it, and sends the user text to `session/:id/prompt_async`.
- Submitting the Mission launcher continues to call only `wakeMission`; it does
  not call `panelMessage()` or create a Task.
- Assistant and Mission row delete/rename/stop controls use the same row action
  data hooks and icon classes as Task rows.
- No fallback task path is added for Mission or Assistant.
