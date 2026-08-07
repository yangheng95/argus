# Folder Picker Project List Refresh

## Recall

| Item | Detail |
| --- | --- |
| User request | “选择文件夹，确定后，左侧项目中不会更新项目列表”。 |
| Goal | Selecting and confirming a project folder must register the project through the canonical backend lifecycle and update the left Projects list immediately, including for an empty project. |
| Acceptance criteria | The folder-picker path stays on `browseDirectory -> setDirectory -> applyDirectory`; the global Work Ledger Server-Sent Events (SSE) stream remains subscribed while the directory-scoped task-list stream is retargeted; the backend `project.updated` event reaches the existing Work Ledger refresh handler; a real Node-run browser fixture shows the newly selected empty project in the left list without refreshing the app. |
| Hard constraints | No delayed refresh, polling, local guessed project row, fallback, compatibility path, gate, second project source, state machine, running OpenCorvus/Overlay restart, or modification of the user's unrelated dirty tests. Desktop-only visual acceptance. Use existing host picker, backend project projection, Work Ledger stream, Solid component, and Node-based browser runner. |
| Existing records read | `specs/records/2026-07/2026-07-09-work-ledger-open-project-immediate-projection.md`; `specs/records/2026-07/2026-07-15-borderless-conversation-and-seamless-project-loading.md`; `specs/README.md`; `specs/records/2026-07/README.md`. |
| Code read | `packages/overlay/src/main.tsx`; `packages/overlay/src/services/workspace.ts`; `packages/overlay/src/services/config.ts`; `packages/overlay/src/services/connection.ts`; `packages/overlay/src/services/init.ts`; `packages/overlay/src/services/sse.ts`; `packages/overlay/src/services/work-ledger.ts`; `packages/overlay/src/components/WorkLedger.tsx`; backend Work Ledger route/projection and their existing tests. |
| Whole-repository grep | Enumerated every `browseDirectory`, `setDirectory`, `applyDirectory`, `reloadProjectScope`, `startTaskListSSE`, `stopTaskListSSE`, `startWorkLedgerSSE`, `stopWorkLedgerSSE`, `setWorkLedgerChangeHandler`, `work-ledger.changed`, `project.updated`, `refreshToken`, and `directoryEpoch` production/test call site. The lifecycle mutation is confined to `sse.ts`, `init.ts`, and directory switching in `workspace.ts`; `main.tsx` already owns the sole Work Ledger refresh signal. |
| External references | The current WHATWG HTML Server-Sent Events specification confirms that an explicitly closed event stream stops dispatch and reconnect behavior; current Solid documentation confirms that the existing Work Ledger effect reruns only when its tracked connection/refresh dependencies change. These support preserving the global stream rather than adding a timer-based local refresh dependency. |
| Independent agent feedback | No sub-agent was started because the user did not request delegation and the active collaboration policy forbids unrequested sub-agents. The primary agent owns the required second review. |

## Root cause

The backend and projection are already correct: opening a new directory initializes `ProjectTable`, emits `project.updated`, and `/work-ledger` can return an empty `project` row. The regression is in Overlay stream ownership.

`applyDirectory()` performs a background health preflight so an already-online UI remains `online`, then calls `stopTaskListSSE()`. That function also closes the global `/work-ledger/events` stream even though only `/task/events` is directory-scoped. During `reloadProjectScope()`, the backend registers the selected folder and emits `project.updated` while the global stream is closed. `startTaskListSSE()` opens it again only after the event is gone. Because the connection state stayed `online` and the Work Ledger `refreshToken` did not change, the Solid effect has no dependency change to reload the list. The visible result is a successfully selected project whose left-list projection remains stale.

This is a lifecycle-boundary defect, not a project-row projection defect. A manual refresh token bump, delayed request, local optimistic row, or directory-epoch timer would hide the missed-event window and create a second refresh source.

## Call-site disposition

| Surface | Current role | Disposition |
| --- | --- | --- |
| `sse.ts::startWorkLedgerSSE/stopWorkLedgerSSE` | Private global Work Ledger stream lifecycle, nested under task-list lifecycle | Export as the explicit global stream lifecycle; keep its existing retry/error/handler behavior. |
| `sse.ts::startTaskListSSE/stopTaskListSSE` | Directory task stream plus global Work Ledger stream | Retain only directory task stream and its refresh timer; delete the nested Work Ledger start/stop calls. |
| `init.ts::initApp` initial-connect path | Starts list streams only when a project directory loaded | Start the global Work Ledger stream whenever the server is connected; start the directory task stream only when a directory loaded. |
| `init.ts::initApp` reconnect path | Reopens list streams after project data reload | Reopen the global Work Ledger stream on the recovered connection, and the task stream when a directory loaded. |
| `init.ts::teardownApp` | Stops selected-task and combined list streams | Explicitly stop selected-task, task-list, and global Work Ledger streams. |
| `workspace.ts::applyDirectory` | Stops/restarts directory projections around a switch | Keep stopping/restarting only the directory-scoped task stream; the global Work Ledger stream remains live and observes `project.updated`. |
| `workspace.ts::closeProject` | Stops selected-task and task-list streams | Keep global Work Ledger live because the Projects list remains a global surface after active-directory closure. |
| Tests importing list-stream lifecycle | Assume cleanup also closes Work Ledger | Update relevant cleanup to call the explicit global stop; add a regression proving a task-list retarget does not close/reopen the Work Ledger stream and that `project.updated` still reaches the handler. |

## Implementation plan

1. Separate global Work Ledger stream start/stop exports from directory task-list start/stop without changing either wire protocol or reconnect semantics.
2. Give application initialization/reconnect/teardown explicit ownership of the global stream. Keep folder switching and project closure limited to the directory task stream.
3. Add focused lifecycle tests that reproduce the missed-event window and prove the global stream stays live through task-list retargeting.
4. Add a real browser regression that selects a folder through the existing host picker, emits the backend-shaped `project.updated` event during project reload, and verifies the new empty project appears in the left Projects list without page refresh. Save and personally inspect a task-scoped desktop screenshot.
5. Run focused tests, Overlay typecheck/build, documentation health, `git diff --check`, and a second diff review. Commit only attributable files with the `dsw-33987` prefix and push the current branch to `myhexin`.

## Verification plan

```powershell
bun test packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/workspace-active-directory.test.ts packages/overlay/test/work-ledger-consolidation.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-folder-picker-work-ledger.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Verification results

- `bun test packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/workspace-active-directory.test.ts packages/overlay/test/work-ledger-consolidation.test.ts --timeout 90000`: 48 passed, 0 failed, 526 assertions.
- `bun test packages/overlay/test/sse-parse-error.test.ts packages/overlay/test/initial-workspace-restore-directory-sync.test.ts --timeout 90000`: 13 passed, 0 failed, 56 assertions. Existing stream parse/error reporting and initial workspace retargeting remain intact.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-folder-picker-work-ledger.test.ts`: 1 passed, 0 failed. The real File > Open Folder host-picker path changed the active directory, received `project.updated`, displayed the selected empty project with a zero count, and kept the global Work Ledger stream at one open and zero closes through the switch.
- `.scratch/folder-picker-project-list-refresh.png`: personally inspected at the task-scoped Projects region. `Picked Project` appears above `Initial Project`, both labels/counts are readable, and the empty selected project has no fabricated child row.
- `bun run --cwd packages/overlay typecheck`: passed.
- Overlay production `vite build`, exercised by the Node browser runner after the implementation change: passed. Vite reported only the existing large-chunk advisory.
- `git diff --check` for the attributable implementation, tests, and records: passed.
- Documentation health: content, link, and single-source assertions passed; final tracked-record assertion will be rerun after attributable staging because this record and an unrelated concurrent Multica record are both currently untracked.

## Second review

The second review rechecked stream ownership against every enumerated call site and the browser evidence. The global `/work-ledger/events` route has no directory query and is now owned explicitly by application connect, reconnect, and teardown. `/task/events` remains directory-scoped and is the only list stream stopped and restarted by `applyDirectory()` and `closeProject()`. The existing `main.tsx` handler remains the sole refresh signal, while the existing backend Work Ledger projection remains the sole project-row source.

The change introduces no polling, delayed retry masquerading as refresh, optimistic project row, directory-derived duplicate source, fallback, compatibility branch, gate, or new workflow state. The runtime regression proves that retargeting closes the old task stream once, opens the selected-directory task stream, leaves the Work Ledger stream open, and delivers the backend-shaped `project.updated` event to the existing handler. The browser regression proves the same boundary through the visible host-picker workflow and confirms the selected empty project is rendered without an app refresh. No running OpenCorvus or Overlay process was restarted or otherwise disturbed.
