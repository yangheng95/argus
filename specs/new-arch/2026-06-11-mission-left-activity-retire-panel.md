# Mission Left Activity And Panel Retirement

Date: 2026-06-11

## Objective

Expose Mission as a member of the overlay Task panel's left activity toolbar and
retire the standalone Mission page/panel. The resulting navigation model is:

1. Mission ledger in the left activity panel.
2. Mission-created task projections under each Mission row.
3. The existing center workflow chat as the single chat surface for either a
   selected Mission session or a selected task.

The Mission Channel rail is retired. Channel configuration/runtime ownership
stays in the Settings surface; this change does not create another channel
projection.

## Call Points

| Surface | Current owner | Decision |
| --- | --- | --- |
| Mission entry | `packages/overlay/src/index.html#btnMission` plus `packages/overlay/src/main.tsx::setPageMode("mission")` | Delete the static button. Add `mission` to `LeftActivity` and `LEFT_ACTIVITIES`. |
| Mission mount | `packages/overlay/src/index.html#solidMissionMount` mounted from `main.tsx` | Delete the standalone mount. Add `leftPanelMissions` beside the existing left activity bodies and mount `Mission` there. |
| Page mode | `packages/overlay/src/store/page-mode.ts`, `body[data-page-mode]`, `isMissionPage()` gates in `Mission.tsx` | Retire the page-mode source. Mission activity selection is the only UI source for Mission visibility. |
| Mission layout | `Mission.tsx` three-column layout using `MISSION_PANE_CONFIG` | Collapse to a left-panel ledger/launcher component. The existing Panel layout owns resize. |
| Mission chat | `MissionConversation` renders a second `Conversation`, `ConversationAgentRail`, `WorkspacePanel`, and `ChatComposer` | Delete it. Mission sessions hydrate `boardStore.selectedSource = { kind: "session" }`; the center workflow chat renders from the shared stores. |
| Mission tasks | `MissionList.tsx::MissionTaskProjectionRow` is read-only | Add a task-select callback that calls `selectTask(task.id)`, preserving `selectTask` as the directory/SSE/hydration source. |
| Mission Channel rail | `MissionChannelPanel`, `loadChannelList`, `loadChannelRuntime`, `restartChannelRuntime` in `Mission.tsx` | Delete from Mission. Settings remains the channel configuration surface. |
| Tests | `mission-html-entry`, `mission-page-mode`, `pane-config`, `acceptance-panel-mount`, `mission-launcher-component`, browser perf/visual tests | Rewrite source-level contracts to assert no standalone Mission panel and Mission as a left activity. |

## Acceptance

- `index.html` has no `btnMission` and no `solidMissionMount`.
- `main.tsx` has no `pageMode`, `setPageMode`, or `body.dataset.pageMode`.
- `LeftActivity` includes `mission`; `leftPanelMissions` is mounted from
  `main.tsx`.
- `Mission.tsx` does not import or render channel runtime/list code.
- `Mission.tsx` does not render a second conversation, agent rail, workspace,
  or session composer.
- Mission task projection rows call the same task selection path as the Task
  ledger.
- Focused overlay tests cover the new source contract.
