# Mission row directory action fix

Date: 2026-06-12

## Problem

The Mission ledger can list a row for `/mnt/c/Users/chuan/myhexin-local/demos/economy/economy5`, but deleting that row calls
`DELETE /mission/5bd59eb233c1846c?directory=...` and returns 404:
`Mission not found: 5bd59eb233c1846c`.

## Root Cause

`GET /mission` is a global ledger query. It finds Mission sessions by the
session row's `directory` without constraining to the currently bootstrapped
project. Mission action routes then call `getMissionSession(missionID)`, which
uses `Instance.project.id`. If the session row's persisted `project_id` does
not match the project identity now derived from that directory, the list can
show a row that the action route cannot find.

## Call Points

| Surface                                                                 | Evidence                                                                                                | Decision                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mission/session.ts::listGlobalMissionSessions` | Uses `missionSessionConditions(input)` without project ID and supports `directory`.                     | Keep as ledger source.                                                                                        |
| `packages/opencorvus/src/mission/session.ts::getMissionSession`         | Uses `findMissionSessionID(missionID)` scoped to `Instance.project.id`.                                 | Keep for project-scoped creation/wake semantics. Add a directory-record lookup for row actions.               |
| `packages/opencorvus/src/server/routes/mission.ts`                      | `GET/PATCH/POST/DELETE /mission/:missionID...` ignore the request directory after middleware bootstrap. | Use `Instance.directory` as the already-decoded request directory for row action lookups.                     |
| `packages/opencorvus/src/session/index.ts::remove`                      | Deletes only when the target session belongs to `Instance.project.id`.                                  | Mission delete must call `removeInProject` with the found session's own `projectID`.                          |
| `packages/opencorvus/test/server/mission-routes.test.ts`                | Existing disambiguation test only covers two current git projects.                                      | Add a regression with a stale project ID and matching directory, proving the action follows the row identity. |

## Acceptance

- `GET /mission?directory=<dir>` and `DELETE /mission/:missionID?directory=<dir>` resolve the same Mission row identity.
- Mission delete removes the matched session even when its persisted
  `project_id` differs from the current `Project.fromDirectory(directory)` ID.
- Mission action routes still reject non-Mission sessions.
- Existing same-`missionID` cross-directory disambiguation remains intact.
