# Mission global row action directory scope

Date: 2026-06-09

## Problem

Mission ledger loading and Mission row actions use different project scopes.

Evidence:

| Area                  | Evidence                                                                                                                                                       | Effect                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Ledger fetch          | `packages/overlay/src/services/api.ts` excludes exact `mission` from directory injection.                                                                      | `loadMissions()` calls `GET /mission` as an all-project ledger.                                       |
| Backend list route    | `packages/opencorvus/src/server/routes/mission.ts` calls `listGlobalMissionSessions()`.                                                                        | Rows from multiple project directories can appear in one ledger.                                      |
| Row action service    | `packages/overlay/src/services/mission.ts` calls `mission/${missionID}`, `mission/${missionID}/abort`, and `mission/${missionID}/title` without row directory. | `api.ts` injects the active overlay directory, not the clicked row directory.                         |
| Backend action lookup | `packages/opencorvus/src/mission/session.ts` resolves `getMissionSession()` through `Instance.project.id`.                                                     | If the clicked Mission belongs to another directory, delete/abort/rename returns `Mission not found`. |
| Error label           | `packages/overlay/src/i18n/en-US.json` and `zh-CN.json` map `mission.error.action.delete` to task wording.                                                     | Mission delete failures are displayed as task delete failures.                                        |

## Callsite disposition

| Callsite                                         | Disposition                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `loadMissions()`                                 | Keep all-project ledger behavior; it is already paired with directory-grouped `MissionList`.                             |
| `MissionRecord.directory`                        | Use as the single source for row-action project scope.                                                                   |
| `renameMission`, `abortMission`, `deleteMission` | Change from a bare `missionID` parameter to a target object containing `missionID` and `directory`.                      |
| `Mission.tsx` handlers                           | Pass the clicked `MissionRecord` into action services so the row directory is preserved.                                 |
| `api.ts` directory injection                     | Keep exact `mission` no-inject and project-scoped action paths injectable. Explicit `?directory=` from row actions wins. |
| Backend `getMissionSession()`                    | Keep project-scoped lookup because `missionID` uniqueness is `(project, missionID)`, not global.                         |
| Mission action i18n                              | Rename delete action label to Mission wording.                                                                           |

## Design

Mission row actions build URLs with an explicit `directory` query from the row:

```ts
mission/<missionID>/abort?directory=<mission.directory>
mission/<missionID>?directory=<mission.directory>
mission/<missionID>/title?directory=<mission.directory>
```

The explicit query is not a fallback. It is the row action contract: a global
ledger row carries the project directory required to address its project-scoped
Mission session. `api.ts` already preserves caller-provided `directory`, so the
active overlay directory cannot overwrite the clicked row scope.

Backend global missionID resolution is intentionally not introduced. The
existing mission session key is `(project, missionID)`, and a global lookup by
missionID alone would be ambiguous.

## Tests

- Overlay Mission service action tests assert rename/abort/delete include the
  clicked row directory in the request query.
- Overlay API directory injection tests assert explicit directory remains
  preserved for Mission action routes.
- Mission i18n test asserts Mission delete failures use Mission wording, not
  task wording.
