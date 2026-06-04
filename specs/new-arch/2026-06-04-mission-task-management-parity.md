# Mission task-management parity

Date: 2026-06-04

## Objective

Make Mission management operate from the same surface position and action
model as task management:

- the Mission list panel appears in the same top-left column position as the
  task list, below the same page chrome level;
- starting a new Mission uses the same bottom composer position as starting a
  new task from the task tab;
- the standalone Mission refresh button is removed;
- Mission rows expose stop, rename, and delete actions equivalent to task rows;
- the default Mission input surface reuses the default message composer chrome;
- conversation cards visually distinguish `user` and `mission` roles.

## Current callsites

| Area | Callsite | Disposition |
| --- | --- | --- |
| Panel task tab | `packages/overlay/src/index.html` `#btnCreateTask` and `#taskListPanel` | Keep task behavior unchanged. |
| Mission entry | `packages/overlay/src/index.html` `#btnMission`, wired in `main.tsx` | Keep as the Mission tab entry. |
| Mission page header | `packages/overlay/src/components/Mission.tsx` `MissionHeader` | Remove row-level refresh action; retain the Panel back affordance only as page navigation. |
| New task flow | `main.tsx` `btnCreateTask` clears selection and focuses `#solidChatComposer textarea` | Mirror in Mission by clearing selected mission, showing launcher, and focusing the Mission composer in the workbench column. |
| Mission list | `Mission.tsx` renders `MissionList` with `loadMissions` | Extend `MissionList` actions; do not reintroduce `TaskList` or `visibleTasks`. |
| Task row actions | `TaskList.tsx` `CancelButton`, `RenameButton`, `DeleteButton` | Reuse the same interaction pattern locally in `MissionList`, backed by Mission APIs. |
| Mission API | `packages/opencorvus/src/server/routes/mission.ts` has `GET /mission` and `POST /mission/wake` | Add mission-scoped abort, rename, and delete routes that validate the row is a real Mission session. |
| Session source | `Session.setTitle`, `Session.remove`, `SessionPrompt.cancel` | Use these session primitives. Do not duplicate session storage. |
| Mission input | `MissionComposer` currently renders custom textarea shell | Replace its text input shell with `ChatComposer` while keeping the optional missionID field and wake endpoint. |
| Conversation card role | `Conversation` -> `ChatBubble` / card role utils | Ensure `mission` messages get their own role styling and do not collapse into assistant/user ambiguity. |

## API design

Add these Mission routes:

```http
PATCH /mission/:missionID/title
POST /mission/:missionID/abort
DELETE /mission/:missionID
```

Every route resolves the mission through the existing session single source:
`kind = "mission"` plus valid `metadata.mission.id`. If the mission is not
found, return the existing route error handling. Abort delegates to
`SessionPrompt.cancel(session.id)`, rename delegates to `Session.setTitle`,
and delete delegates to `Session.remove`.

No archive compatibility path is introduced because the requested action is
delete, matching task row deletion.

## Frontend design

`MissionList` owns only row chrome and row actions. `Mission.tsx` owns API calls,
selection cleanup, list refresh, and composer visibility.

The default empty/new Mission state is `MissionComposer`, but its text entry is
`ChatComposer` so it has the same default message-panel input behavior as tasks.
`MissionComposer` passes the text to `wakeMission` and clears through the
existing composer submit lifecycle.

The Mission page no longer has a manual refresh button. List refresh remains
data-driven after wake, rename, delete, abort, and message submit.

## Tests

- Backend route tests cover mission rename, abort, delete, and non-mission
  rejection.
- Overlay service tests cover the three new client functions.
- Mission component/source tests assert no refresh button, MissionList receives
  row action callbacks, and the composer uses `ChatComposer`.
- i18n tests cover new Mission action labels.
- Role-rendering tests assert `mission` messages are visually distinct from
  `user` messages.
