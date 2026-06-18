# Overlay Diff Poll Pressure

Date: 2026-06-19
Status: Implementation plan

## Acronyms

- UI: User Interface, the visible overlay controls and panels.
- API: Application Programming Interface, the HTTP route surface served on port 7878.
- SSE: Server-Sent Events, the long-lived event stream used by the overlay.
- DB: Database, the SQLite store at `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.
- WAL: Write-Ahead Log, SQLite's append log beside the DB file.
- PID: Process Identifier, the operating-system process id.

## Problem

Port 7878 feels slow while the overlay sidecar is otherwise responsive. Local inspection showed PID 19848 (`opencorvus.exe serve --hostname 127.0.0.1 --port 7878`) with about 1.2-1.4 GB working set, 2.3-2.5 GB private memory, 22 `CloseWait` server connections, and a 47 MB runtime log. The static `/ui/` entry is fast, so the pressure is not the socket listener or static shell.

Two hot paths showed up while the selected task is active: repeated overlay data fetching and high-volume scheduler logging.

| Evidence | Result |
| --- | --- |
| `GET /ui/` | 17 ms |
| `GET /provider?directory=...` | 168-226 ms, 3.7 MB |
| `GET /task/tsk_edb303f00001koOay5ND4C22Wo/conversation?directory=...` | 1.44 MB, 399-1207 ms |
| Recent 20k log lines | 4 `/goal-run/:id/acceptance` routes each requested about 790 times |
| Recent 20k log lines | `engine.liveness` logged 4933 successful scheduler runs at INFO level |
| 8-second live log sample | 102 `engine.liveness` entries, about 12.75 successful scheduler-run log rows per second |
| Browser preview evidence capture | one `/browser-preview/capture` request took 14.4 s |

The acceptance diff burst is self-inflicted by the overlay. `ChangesPanel` builds its resource key from `cardTreeStore.visibleVersion`. That version changes for ordinary visible conversation updates, even when the file-change groups did not change. Each key change calls `resolveCurrentChangeGroups()`, which asks each goal-run acceptance route for full diffs when local stubs only have zero stats. Goal-runs with no full acceptance diff return no useful body, so the same endpoints are fetched repeatedly.

The scheduler log burst is separate. `EngineService.init()` registers `engine.liveness` per project instance with `ORCHESTRATOR_POLL_INTERVAL_MS` set to 500 ms. That liveness tick is intentionally narrow and should remain in place, but `Scheduler.run()` logs every successful tick at INFO level before calling the task. With many active instances, the default log file becomes an IO sink even when the scheduler is healthy. Successful heartbeat ticks are diagnostic detail, not operator-level events; failures already log through `run failed`.

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `ChangesPanel` request key | `packages/overlay/src/components/ChangesPanel.tsx` includes `cardTreeStore.visibleVersion` in the key. | Remove the broad visible-tree dependency. Keep task id, board snapshot, agent file-change key, and source group key. |
| Agent file groups | `collectAgentFileChangeGroupsFromNodes(...)` derives file groups from `cardTreeStore.order` and `cardTreeStore.cards`. | Keep the explicit `agentKey` in the request key; this is the narrow data dependency. |
| Diff loading | `packages/overlay/src/services/diff.ts::resolveCurrentChangeGroups()` calls `/goal-run/:id/acceptance` only to upgrade zero-stat stubs. | Keep the service contract unchanged in this pass. Do not cache missing goal-run acceptance forever because a live goal-run can later produce an acceptance row under the same id. |
| Inline diff | `FileChangesView.tsx::InlineDiffPanel` resolves a single row only when expanded. | Keep this lazy path unchanged. |
| Backend routes | `/goal-run/:id/acceptance` and `/run/:id/acceptance` are the single source for acceptance diffs. | Do not add route compatibility, alternate caches, or fallback bodies. |
| Scheduler liveness | Existing `operator-wake-status-facts-not-scheduler-2026-06-17.md` preserves narrow `engine.liveness`. | Keep the 500 ms liveness behavior unchanged. Lower only successful scheduler tick logging from INFO to DEBUG; keep failed runs at ERROR. |

## Implementation

1. Remove `cardTreeStore.visibleVersion` from the `ChangesPanel` request key.
2. Add a regression test that rejects reintroducing `cardTreeStore.visibleVersion` into the `ChangesPanel` acceptance-diff resource key while keeping `agentKey` and `changeGroupsRevisionKey(...)` present.
3. Move the scheduler's successful `run` log from INFO to DEBUG while keeping `run failed` as ERROR.
4. Add a regression test that rejects reintroducing INFO-level success tick logging.
5. Re-run the focused overlay and scheduler tests, then recheck local 7878 request pressure after the edit.

## Acceptance

- `ChangesPanel` no longer keys acceptance diff resolution on `cardTreeStore.visibleVersion`.
- Agent-derived file groups still participate in the key through `agentKey`.
- The fix does not modify backend acceptance routes or add missing-diff caching.
- Scheduler liveness registration and interval stay unchanged.
- Successful scheduler ticks no longer write INFO log rows by default; scheduler failures still write ERROR rows.
- Focused overlay regression tests pass.
- Focused scheduler regression tests pass.
- A post-fix source review confirms no broad visible-tree dependency remains in the acceptance diff request key.
