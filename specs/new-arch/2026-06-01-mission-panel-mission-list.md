# Mission panel mission list and history spec

Date: 2026-06-01

## Objective

Refactor the Mission panel so the left ledger is a Mission list, not a task
list. A user must be able to select a Mission record and see that Mission's
message history in the existing conversation surface.

The implementation must stay focused on Mission panel behavior:

- Mission records come from Mission sessions.
- Mission history comes from the existing session conversation and session
  event stream.
- The main task list keeps its current task semantics.
- No new message table, synthetic UI-only messages, fallback data source, or
  compatibility path is introduced.

## Current state evidence

| Area                        | Evidence                                                                                                                                                                                                                | Current behavior                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Mission page left ledger    | `packages/overlay/src/components/Mission.tsx` imports `TaskList`, computes `missionTasks = visibleTasks()`, filters those tasks, and renders `<TaskList ... />`.                                                        | Mission panel left side is a task projection. It is not a Mission record list.             |
| TaskList semantics          | `packages/overlay/src/components/TaskList.tsx` owns `visibleTasks()`, queue reorder, active task selection, task status rows, task children, cancel/delete controls, and task-specific keyboard/drag behavior.          | Overloading `TaskList` with Mission records would mix Mission and task semantics.          |
| Mission wake                | `packages/opencorvus/src/server/routes/mission.ts` only exposes `POST /mission/wake`.                                                                                                                                   | The server can start/resume a Mission but cannot list Missions for the panel.              |
| Mission session source      | `packages/opencorvus/src/mission/session.ts` creates sessions with `kind: "mission"` and stores `metadata.mission.id` plus `metadata.mission.channelKey`.                                                               | The authoritative Mission record is already the session row plus Mission metadata.         |
| Session history             | `packages/opencorvus/src/server/routes/session.ts` exposes `GET /session/:sessionID/conversation` and `GET /session/:sessionID/events`.                                                                                 | A selected Mission can already be hydrated and streamed by session ID.                     |
| Overlay session source      | `packages/overlay/src/services/conversation.ts` and `packages/overlay/src/services/sse.ts` accept `BoardSource = { kind: "session", id }`.                                                                              | The frontend already has the correct history transport for Mission sessions.               |
| Existing tests              | `packages/overlay/test/mission-session-source.test.ts` asserts Mission session hydration/submission. `packages/opencorvus/test/server/session-conversation-routes.test.ts` covers Mission session conversation and SSE. | Tests prove the history surface exists, but the left ledger still asserts task-list reuse. |
| Route registration/docs     | `packages/opencorvus/src/server/routes/app.ts` mounts `MissionRoutes` at `/mission`; `docs/product/*/reference/api.md`, `packages/sdk/openapi.json`, and generated SDK files currently list only `/mission/wake`.       | Adding `GET /mission` changes the API surface and generated docs/SDK snapshots.            |
| Overlay directory injection | `packages/overlay/test/api-directory-injection.test.ts` enumerates project-scoped routes that must receive the active directory.                                                                                        | The new `mission` route must be added to this test because it is project-scoped.           |
| Mission visual fixture      | `packages/overlay/test/mission-visual-loop.ts` mocks `/mission/wake` but has no `/mission` fixture.                                                                                                                     | Visual verification must show Mission rows, not task rows.                                 |

## Current callsite disposition

| Callsite                                                                                                                                                                                     | Current role                                                                          | Required disposition                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Mission.tsx` imports `TaskList`, `loadTasks`, `taskByID`, `visibleTasks`, `activeTaskID`, `cancelTask`, `deleteTask`, `selectTask`, `filterMatches`, `pendingInteractions`, `LedgerFilter`. | Powers the Mission left task ledger and selected task actions.                        | Remove from the Mission ledger path. Keep only code that is still needed by explicit task secondary content, or delete the secondary task surface if it becomes unreachable.                 |
| `Mission.tsx` `filter`, `scope`, `searchQuery` signals.                                                                                                                                      | Task status filter, project/global task scope, task search.                           | Replace with Mission-list query/search state. Remove project/global scope for this implementation because `GET /mission` is current-project scoped.                                          |
| `missionTasks`, `filteredTasks`, `counts`.                                                                                                                                                   | Derives task rows and task status counters from `visibleTasks()`.                     | Replace with `missionRecords`, route-backed search result state, and Mission counters that do not use task status taxonomy.                                                                  |
| `refreshAll`.                                                                                                                                                                                | Refreshes stats/runtime/channel/tasks.                                                | Refresh Mission records as part of the same user refresh; do not call `loadTasks()` for the Mission ledger.                                                                                  |
| `handleCancelTask`, `handleDeleteTask`, `selectTask` callbacks passed to `MissionTaskLedger`.                                                                                                | Task row actions in the Mission ledger.                                               | Delete from Mission list. If task secondary content remains, actions must be scoped there and not wired to Mission rows.                                                                     |
| `MissionTaskLedger` and local `FILTERS`.                                                                                                                                                     | Renders search, task status filters, scope toggle, task load error, and `<TaskList>`. | Replace with `MissionLedger` or `MissionList` backed by `MissionRecord[]`; remove task status filters and the all-project scope toggle.                                                      |
| `MissionHeader counts`.                                                                                                                                                                      | Displays task status counts.                                                          | Replace with Mission counts such as total, active/idle from session status only if a single source exists; otherwise show total/recent update only. Do not derive Mission health from tasks. |
| `mission.css` `.mission-ledger-list .task-list-panel` and `.project-group-heading`.                                                                                                          | Adapts TaskList CSS inside Mission.                                                   | Remove and replace with domain-neutral `.ledger-list`/`.ledger-row` styles. Mission rows must not use `.task-row-mini`.                                                                      |
| `mission-session-source.test.ts`.                                                                                                                                                            | Asserts Mission reuses `TaskList`.                                                    | Invert this assertion: Mission imports `MissionList` and does not import `TaskList` or call `visibleTasks()` for the ledger.                                                                 |
| `mission-launcher-component.test.ts`.                                                                                                                                                        | Asserts launcher/wake wiring and MissionConversation presence.                        | Add wake success list refresh/select expectations or source checks.                                                                                                                          |
| `mission-i18n.test.ts`.                                                                                                                                                                      | Requires task status/filter wording under `mission.ledger.*`.                         | Replace task status/filter keys with Mission list wording and ensure zh-CN/en-US coverage matches.                                                                                           |
| `api-directory-injection.test.ts`.                                                                                                                                                           | Enumerates project-scoped overlay API routes.                                         | Add `mission` and keep `mission/wake` covered as project-scoped calls.                                                                                                                       |
| `mission-visual-loop.ts`.                                                                                                                                                                    | Visual fixture for launcher and wake.                                                 | Mock `GET /mission` and render Mission rows in the captured state.                                                                                                                           |

## Refined requirements

1. The Mission panel left ledger shows Mission records, sorted by most recently
   updated first.
2. Each Mission row exposes at least:
   - `missionID`
   - `sessionID`
   - title
   - directory
   - created time
   - updated time
   - archived time when archived
3. Selecting a Mission row sets the board source to
   `{ kind: "session", id: sessionID }`.
4. Selecting a Mission hydrates history through
   `GET /session/:sessionID/conversation`.
5. Selecting a Mission streams updates through
   `GET /session/:sessionID/events`.
6. Starting a new Mission through `POST /mission/wake` refreshes the Mission
   list and selects the returned `sessionID`.
7. Resuming an existing Mission through `POST /mission/wake` refreshes the row
   and selects the returned `sessionID`.
8. The Mission list supports the current ledger affordances that make sense for
   Missions: search, selected row styling, empty state, loading state, error
   state, time display, and compact density.
9. The Mission list does not expose task-only controls: queue drag/reorder,
   task tree expansion, cancel task, delete task, task priority, task child
   counts, or task binding actions.
10. The ordinary task list outside Mission remains behaviorally unchanged.

## Non-goals

- Do not redesign the whole Mission page.
- Do not change Mission agent prompts or benchmark behavior.
- Do not introduce a Mission message store separate from session messages.
- Do not use generic client-side filtering of all sessions as the Mission list
  contract.
- Do not preserve the old task-list ledger inside the Mission panel as a
  compatibility mode.
- Do not add state-machine orchestration for Mission selection; use the
  existing session source and event stream contracts.

## Backend design

### Route

Add a Mission list route to `MissionRoutes`:

```http
GET /mission
```

Query parameters:

| Name              | Type              | Behavior                                                                    |
| ----------------- | ----------------- | --------------------------------------------------------------------------- |
| `directory`       | string, optional  | Filter Mission sessions by directory.                                       |
| `search`          | string, optional  | Search Mission title and mission ID.                                        |
| `limit`           | number, optional  | Maximum rows, default 100.                                                  |
| `cursorUpdated`   | number, optional  | Compound cursor updated timestamp. Must be supplied with `cursorSessionID`. |
| `cursorSessionID` | string, optional  | Compound cursor session ID. Must be supplied with `cursorUpdated`.          |
| `archived`        | boolean, optional | Include archived rows when true. Default false.                             |

Response schema:

```ts
const MissionRecord = z.object({
  missionID: MissionID,
  sessionID: z.string(),
  title: z.string(),
  directory: z.string(),
  created: z.number(),
  updated: z.number(),
  archived: z.number().optional(),
})
```

The route returns `MissionRecord[]`, ordered by `updated desc`, then
`sessionID desc`. Pagination uses the compound predicate:

```sql
time_updated < cursorUpdated
OR (time_updated = cursorUpdated AND id < cursorSessionID)
```

`cursorUpdated` and `cursorSessionID` are either both absent or both present.
Using only `updated` is not allowed because two sessions can share the same
timestamp.

### Source of truth

Move the Mission identifier schema out of `packages/opencorvus/src/server/routes/mission.ts`
into a shared Mission-domain module, for example
`packages/opencorvus/src/mission/schema.ts`:

```ts
export const MissionID = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "missionID must be lowercase alphanumerics and hyphens only")
```

`POST /mission/wake`, `GET /mission`, and Mission list tests must import this
schema. Do not duplicate the regex.

Create one Mission-domain helper in `packages/opencorvus/src/mission/session.ts`:

```ts
export function* listMissionSessions(input?: {
  directory?: string
  search?: string
  limit?: number
  cursorUpdated?: number
  cursorSessionID?: string
  archived?: boolean
}): Iterable<MissionSession>
```

The helper queries `SessionTable` directly with these predicates:

- `project_id = Instance.project.id`
- `kind = "mission"`
- `json_extract(metadata, '$.mission.id')` is present
- `MissionID.safeParse(json_extract(...))` succeeds before returning a row
- `time_archived is null` unless `archived` is true
- optional directory/search/cursor predicates

This keeps `SessionTable.kind` plus `metadata.mission.id` as the single Mission
record source. The frontend must not synthesize Mission rows from tasks or from
a generic session list.

### OpenAPI and route tests

The new route must use `describeRoute`, `resolver`, and `validator` like the
existing Mission wake route. Tests must cover:

- only `kind: "mission"` rows are returned;
- the current project filter is applied;
- rows without `metadata.mission.id` are rejected from the list;
- archived rows are hidden by default and included with `archived=true`;
- ordering is `updated desc`;
- `search` matches title and mission ID;
- `limit` and `cursor` page deterministically;
- invalid query pairs such as only `cursorUpdated` or only `cursorSessionID`
  return a validation error;
- the response schema uses `sessionID`, not task ID.

## Frontend design

### Service

Extend `packages/overlay/src/services/mission.ts` with:

```ts
export interface MissionRecord {
  missionID: string
  sessionID: string
  title: string
  directory: string
  created: number
  updated: number
  archived?: number
}

export async function loadMissions(input?: {
  directory?: string
  search?: string
  limit?: number
  cursorUpdated?: number
  cursorSessionID?: string
  archived?: boolean
  signal?: AbortSignal
}): Promise<MissionRecord[]>
```

`loadMissions` calls `mission` and validates that the body is an array. Search
is route-backed: every non-empty search query sent by the Mission ledger reloads
through `GET /mission?search=...`. Do not also maintain a second local search
result set for the same query. A non-array response is a contract error,
matching the existing Mission service style.

The new `mission` route is project scoped. Add it to the overlay directory
injection route enumeration so `apiJson("mission")` carries the active
directory consistently with other AppRoutes.

### Shared ledger reuse

Do not pass Mission records into `TaskList`. `TaskList` is task-specific and
owns task behavior. Instead:

1. Extract a small shared ledger primitive from `TaskList` row chrome:
   `packages/overlay/src/components/LedgerList.tsx`.
2. Keep task behavior in `TaskList`.
3. Add `packages/overlay/src/components/MissionList.tsx` that renders
   `MissionRecord[]` through the shared ledger primitive.

The shared primitive may own visual and generic interaction concerns only:

- selected row styling;
- row button shell;
- compact metadata layout;
- empty/loading/error states;
- timestamp display slots;
- optional search result count text.

It must not import task store, mission service, queue helpers, SSE helpers, or
conversation helpers. Domain-specific actions stay in `TaskList` and
`MissionList`.

### Mission page flow

In `packages/overlay/src/components/Mission.tsx`:

1. Remove the Mission ledger dependency on `visibleTasks()` and `<TaskList>`.
2. Load Mission records through `loadMissions`.
3. Search Mission records through the Mission list route. The component may
   debounce the query, but the displayed result set has one source:
   `loadMissions({ search })`.
4. Render `<MissionList ... />` in the left ledger.
5. On Mission row selection:

```ts
const source = { kind: "session", id: mission.sessionID } as const
stopSSE()
clearMessages()
setChatAttachments([])
resetWriter({ scrollIntent: "bottom", cause: "mission-session-switch" })
setBoardStore("selectedSource", source)
setBoardStore("board", null)
await loadConversation(source, {
  scrollIntent: "bottom",
  resetCause: "mission-session-hydrate",
})
startSSE(source, 0)
```

6. On `wakeMission` success, reload the Mission list and select the returned
   `sessionID`.
7. On a successful follow-up submit from the Mission conversation composer,
   refresh Mission records so the selected row's updated time is not stale.
8. If no Mission is selected, keep the existing Mission empty workbench state.
9. If the selected session disappears from the refreshed list, clear selection
   and stop the stream instead of showing stale task data.

### Mission list state owner

Use a single state owner inside `Mission.tsx` for this implementation. A local
`createResource` plus a refresh token is sufficient:

- source inputs: active directory, search query, archived flag, refresh token;
- fetcher: `loadMissions`;
- loading/error state: rendered by `MissionList`;
- refresh triggers: page entry, manual refresh, successful `wakeMission`,
  successful Mission conversation submit, and explicit search query change;
- cleanup: abort in-flight list request on component cleanup or source change.

Do not add both a global Mission store and a local resource in the same change.

### Channel/task side content

The existing channel/task binding cards in the Mission panel are task-oriented.
They may remain only where they are explicitly tied to a selected task outside
the Mission list. They must not drive the left ledger, and the Mission list must
not require a selected task to display a Mission history.

## Test plan

Backend tests:

- Add route tests for `GET /mission` under `packages/opencorvus/test/server`
  or `packages/opencorvus/test/mission`.
- Add helper tests for `listMissionSessions` in the Mission/session test area.
- Extend OpenAPI/route checks if this repo has route snapshot coverage for new
  operation IDs.

Overlay tests:

- Add a Mission service test that `loadMissions` calls `mission` with encoded
  query parameters and rejects non-array bodies.
- Update `packages/overlay/test/mission-session-source.test.ts` so it no
  longer asserts `<TaskList>` reuse in Mission. Replace that assertion with
  `MissionList` plus shared conversation mounting.
- Add a component/source test that clicking a Mission row sets
  `{ kind: "session", id: sessionID }` and calls the existing conversation
  hydrate path.
- Add a regression test that Mission ledger code no longer references
  `visibleTasks()` or imports `TaskList`.
- Update `packages/overlay/test/mission-launcher-component.test.ts` for wake
  success list refresh/select behavior.
- Update `packages/overlay/test/mission-i18n.test.ts` and locale files so
  Mission ledger keys describe Missions, not task status filters.
- Update `packages/overlay/test/api-directory-injection.test.ts` to include
  `mission` and `mission/wake`.
- Update `packages/overlay/test/mission-visual-loop.ts` fixtures so visual
  captures include Mission rows from `GET /mission`.
- If row chrome is extracted from TaskList, update `.task-row-mini` CSS
  ownership tests to keep task row styling task-owned and add separate
  `.ledger-row` ownership coverage.
- Keep existing TaskList tests passing to prove the extraction did not change
  ordinary task-list behavior.

Manual verification after implementation:

1. Start the overlay dev server.
2. Open the Mission panel in the in-app Browser.
3. Start a new Mission.
4. Confirm the left ledger shows a Mission row, not a task row.
5. Click the Mission row.
6. Confirm prior user/agent/tool messages render in the workbench.
7. Send a follow-up Mission prompt.
8. Confirm the row updates and the live session stream appends new messages.

## Acceptance criteria

- Mission panel left ledger is driven by `GET /mission` records.
- Mission row click opens the corresponding session history.
- New/resumed Mission wake refreshes the list and selects the correct Mission.
- Existing task list behavior outside Mission is unchanged.
- No compatibility/fallback path keeps the old task ledger in Mission.
- Backend and overlay tests cover the new route, service, selection behavior,
  and TaskList/MissionList separation.

## Open questions resolved for this implementation

| Question                                                     | Decision                                                                                                                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Should the first Mission list be global across all projects? | No. Use current project scope to match `ensureMissionSession` and avoid cross-project selection surprises. Add global scope only with a separate product requirement. |
| Should Mission records duplicate message history?            | No. Session messages are the only message history source.                                                                                                             |
| Should `TaskList` accept a union of task and Mission rows?   | No. Extract shared ledger chrome and keep domain lists separate.                                                                                                      |
| Should task/channel bindings appear in the Mission list?     | No. Bindings may stay in task-specific secondary content but cannot define Mission records.                                                                           |

## Independent review

Completed by independent agent Ramanujan on 2026-06-01.

Required changes incorporated:

- corrected the invalid `loadConversation(..., { force: true })` snippet to
  the current stream-safe Mission session switch sequence;
- replaced timestamp-only pagination with compound cursor pagination;
- added explicit callsite disposition for task filters, counts, scope, task
  actions, CSS, i18n, visual fixtures, and tests;
- required a shared exported `MissionID` schema instead of duplicating the
  regex from the wake route;
- changed Mission search to a route-backed single source;
- added Mission list invalidation after follow-up prompt submission;
- expanded backend and overlay tests for route validation, directory injection,
  i18n, visual fixtures, and no-TaskList/no-visibleTasks regression.
