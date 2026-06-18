# Mission New Launcher Stale Session Fix

Date: 2026-06-12

## Problem

Clicking the Mission toolbar New Mission action opens the shared Mission
launcher, but the center Workflow still shows the previous Mission session's
messages.

## Root Cause

The 2026-06-12 shared composer change correctly moved Mission creation into
`main.tsx::openMissionLauncher`, which clears the current selected source with
`selectTask("")` and activates the mission-scoped composer. However,
`Mission.tsx` still has a legacy effect that automatically selects the newest
Mission row whenever the Mission left panel is active and no session is
selected. The new launcher intentionally creates the same "no selected source"
state, so the effect immediately reopens the old Mission session and hydrates
its conversation into the shared Workflow.

## Call Points

| Surface                                                               | Evidence                                                                                                                        | Decision                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/main.tsx::openMissionLauncher`                  | Sets Mission activity, enables `missionLauncherActive`, then calls `selectTask("")`.                                            | Keep as the single launcher entry. It must leave the Workflow empty until `wakeMission` returns.                                                                                                              |
| `packages/overlay/src/main.tsx::selectLeftActivity`                   | Mission and Coding Assistant both bind the shared Workflow through `selectedSource={kind:"session"}`.                           | When entering Mission from a Coding Assistant session, clear the Assistant source synchronously at the toolbar entry. Preserve Mission sessions only when the selected session is not Coding Assistant-owned. |
| `packages/overlay/src/components/Mission.tsx`                         | `createEffect` calls `handleMissionSelect(mission)` for the first loaded row when Mission is active and no session is selected. | Delete this implicit session selection. Opening a Mission session must come only from an explicit row click or `wakeMission` result.                                                                          |
| `packages/overlay/src/components/Mission.tsx`                         | A second effect closes the selected session when it is absent from the current Mission list rows.                               | Delete it. The ledger page is a projection and can lag after `wakeMission`; session lifetime is owned by explicit row select, `wakeMission`, delete, and toolbar source switching.                            |
| `packages/overlay/src/components/MissionList.tsx`                     | Mission rows already call `props.onSelectMission(props.mission)`.                                                               | Keep this explicit selection path as the single row-open behavior.                                                                                                                                            |
| `packages/overlay/test/mission-launcher-component.test.ts`            | Source contract tests already pin shared composer bindings.                                                                     | Add a regression assertion that Mission no longer auto-opens the first row.                                                                                                                                   |
| `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | Existing browser flow expected Mission activity selection to auto-hydrate the session.                                          | Update it to assert Mission activity alone leaves `selectedSource` empty, row click hydrates the session, and New Mission clears the old session.                                                             |

## Acceptance

- Clicking the Mission activity shows the Mission ledger without automatically
  hydrating the newest Mission session.
- Clicking a Mission row still hydrates that Mission session through the shared
  Workflow source.
- Clicking New Mission from a selected old Mission session clears
  `boardStore.selectedSource`, leaves old message cards out of the center
  Workflow, and activates the Mission launcher composer.
- Mission creation still submits through `wakeMission` and then opens the
  returned Mission session.
- Entering Mission from Coding Assistant clears the Assistant session before
  the Mission list finishes loading, so Assistant messages cannot remain visible
  under the Mission activity.
- A newly woken Mission session remains selected even before `/mission` returns
  a row for it.
