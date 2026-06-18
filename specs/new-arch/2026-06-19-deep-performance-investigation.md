# Deep Performance Investigation

Date: 2026-06-19
Status: Implemented

## Acronyms

- API: Application Programming Interface, the HTTP route surface served by OpenCorvus.
- DB: Database, the SQLite persistence layer used by OpenCorvus.
- SSE: Server-Sent Events, the long-lived event stream used by the overlay.
- UI: User Interface, the visible overlay application.
- CTE: Common Table Expression, a SQL query form that can express recursive tree traversal.

## Goal

Investigate OpenCorvus and overlay performance beyond the shallow hot-spot pass. Use live evidence and repeatable local benchmarks to find root causes, then repair high-confidence defects without changing feature semantics. Existing running processes must not be restarted; source fixes take effect on next normal use.

## Acceptance

- No existing process is restarted, killed, or reloaded.
- Each changed behavior has a targeted test or benchmark assertion.
- No fallback, compatibility alias, stale-cache masking, or gate is introduced.
- Benchmark timeout policy is inactivity-based when a benchmark runner is added.
- The investigation records live evidence, code call chains, fixed candidates, and deferred candidates.
- Focused tests and package typechecks pass before commit.
- After tests pass, perform source review to ensure no unrelated worktree changes are included.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `specs/new-arch/2026-06-19-overlay-diff-poll-pressure.md` | Existing live 7878 pressure included repeated acceptance diff routes and INFO-level scheduler liveness logging. Current live sidecar still runs old code until normal restart. |
| `specs/new-arch/2026-06-19-system-performance-high-confidence-pass.md` | First pass fixed single-session transcript reads, attachment sweep scope, overlay diff in-flight coalescing, and loaded-message explicit-id signature work. Deferred deeper candidates remain open. |
| `specs/new-arch/2026-06-06-overlay-live-efficiency-safe-fix.md` | Selected task message SSE must remain incremental; do not replace it with broad refreshes. |
| `specs/task-queue-explicit-wake-no-poll-2026-06-17.md` | Do not reintroduce background polling as a way to hide missing wakeups. |
| `AGENTS.md` | Every code edit requires tests, no fallback, no gate, no process restart, and no broad git reset. |

## Live Evidence

Measured against the existing `127.0.0.1:7878` sidecar without restarting it:

| Evidence | Result |
| --- | --- |
| Process | PID `19848`, embedded `opencorvus.exe`, working set about 1.7 GB, private memory about 2.95 GB. |
| TCP state | 1 listener, several established connections, and many `CloseWait` connections owned by PID `19848`. |
| Recent log size | `C:\Users\chuan\.local\share\opencorvus\log\2026-06-18T142926-19848-1.log` about 56 MB. |
| `/ui/` | Warm requests about 8-32 ms, 14.8 KB. Static shell is not the core bottleneck. |
| `/provider?directory=...` | 227-375 ms, 3.7 MB payload. Large provider catalog remains a contract-level hotspot. |
| `/global/tasks` | 14-18 ms, 35 KB. Global task list is not the current dominant route. |
| Recent 50k log lines | `/goal-run/5c8a9c47/acceptance` completed 4737 times. |
| Recent 50k log lines | `/task/tsk_edb303f00001koOay5ND4C22Wo/conversation` completed 197 times, many requests between 1.3 s and 5.2 s. |
| Recent 50k log lines | `/provider/hexin/budget` completed 9 times, slowest 8.2 s, because it performs an upstream HTTP budget fetch. |
| Recent 50k log lines | `engine.liveness` wrote 27394 INFO `run` rows; this confirms the existing live process has not loaded the previous logging fix. |

## Candidate Inventory

| Candidate | Evidence | Decision |
| --- | --- | --- |
| Session tree traversal is N+1 DB queries. | `packages/opencorvus/src/session/index.ts::treeInProject()` and `packages/opencorvus/src/server/routes/orchestrator.ts::taskSessionIDs()` call `childrenInProject()` once per visited session. Conversation hydrate calls this before per-session message reads. | Fix first by moving the shared `Session.treeInProject()` implementation to one project-scoped query and reusing it from `taskSessionIDs()`. |
| Conversation hydrate still builds a full board and two conversation views on each cold load. | `/task/:taskID/conversation` calls `EngineService.getBoard(sync:true)`, `loadTaskTranscript(...)`, `ControlTimeline.list(...)`, `conversationEventPage(...)`, and `projectConversationView(...)` twice when history has more. | Benchmark and defer unless a narrow source-of-truth-preserving projection appears. |
| Conversation history still loads the full task transcript. | `/task/:taskID/conversation/history` calls `loadFullTaskTranscript(taskID)` before slicing. | High impact, but needs a bounded cross-session before-cursor reader; defer until the tree traversal fix is verified. |
| Acceptance diff route storm continues in the live old process. | Logs show 4737 calls for one goal run. Source now has in-flight coalescing, but completed empty diffs intentionally are not cached to preserve live acceptance semantics. | Need overlay trigger-level analysis before another source fix; do not cache missing acceptance forever. |
| Hexin budget route is slow per request. | Route performs `fetch(hexinBudgetURL(), AbortSignal.timeout(15000))`; UI refresh cadence is 10 minutes. | Defer backend caching because budget is external state; UI request frequency appears low. |
| Provider catalog payload is large. | `/provider` is 3.7 MB every load. | Contract-level change; do not trim in this pass without SDK/API plan. |
| Browser preview panel fetches while inactive. | The panel is always mounted; `BrowserPreviewPanel` target resource keys on `boardUpdatedAt` and `browserPreviewLinkRefresh` without checking `active`. Recent logs show repeated `/task/.../browser-preview` calls. | Fix in this pass by making inactive panels produce no target/current target/evidence resource source. |
| ChangesPanel request key still includes global board snapshot. | `ChangesPanel` already computes `agentKey` and `changeGroupsRevisionKey(groups)`, but also includes `boardStore.snapshotVersion`, so unrelated board refreshes can refetch acceptance diffs. | Fix in this pass by removing the global snapshot component from the request key. |
| Log tail reads the whole log file. | `/log/tail` calls `Log.read()`, and `Log.read()` uses `fs.readFile(pathname, "utf8").split("\n").slice(-n)`. Live log is about 56 MB. | Fix in this pass with a real reverse tail reader that only reads enough trailing chunks to return the requested non-empty lines. |

## First Fix Contract

Replace session subtree enumeration with a single-source project-scoped traversal:

1. Keep `Session.treeInProject({ sessionID, projectID })` as the shared public API.
2. Keep `Session.childrenInProject(...)` for direct-child callers and removal recursion.
3. Implement `treeInProject` with one DB query that reads session `id` and `parent_id` rows for the project, then performs deterministic breadth-first traversal in memory.
4. Preserve return order: root first, then descendants in the same direct-child order SQLite returned before for each parent group.
5. Change `taskSessionIDs(taskID)` to call `Session.treeInProject(...)`, not private duplicate BFS.
6. Add a regression test proving `treeInProject` does not call `childrenInProject` per node by asserting the source no longer contains that call inside the `treeInProject` block, and add behavioral coverage for nested task conversation route output.

## First Verification Plan

- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "conversation/session" --timeout 30000`
- `bun test packages/opencorvus/test/session/session-tree.test.ts --timeout 30000`
- `bun run --cwd packages/opencorvus typecheck`

## Second Fix Contract

Reduce repeat work on always-mounted overlay panels and large diagnostic logs:

1. `BrowserPreviewPanel` must not call `loadTaskBrowserPreviewTarget`, load latest evidence, or auto-open from a stale target while `props.active()` is false.
2. Opening the browser preview from a message remains explicit: `openBrowserPreviewFromMessage()` opens the center workbench browser panel, then increments `browserPreviewLinkRefresh`.
3. `ChangesPanel` request identity must be based on `activeTaskID()`, agent-derived change groups, and source change group revisions only; broad board/card visible versions must not refetch the diff.
4. `Log.read({ lines })` must preserve current route shape and missing-file errors while reading only the tail chunks required for the requested non-empty lines.

## Second Verification Plan

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/diff-change-groups.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/server/log-routes.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`

## Independent Agent Findings

Three read-only agents were asked to inspect backend route hot paths, overlay reactive/API pressure, and benchmark coverage. They did not edit files, restart processes, or run destructive commands.

| Area | Highest-confidence findings |
| --- | --- |
| Backend routes | Task list/global board still has per-task DB fan-out in `taskItems(...)`; status routes compile full boards; conversation/history paginates after full transcript reads; `/log/tail` reads whole files; provider payload and sorting remain contract-sized hotspots. |
| Overlay pressure | Always-mounted panels and top-level effects repeatedly scan `cardTreeStore.cards` or broad versions: BrowserPreview inactive requests, InteractionDialogHost, usage aggregation, agent rail workflow projection, Board right-pane projections, ChangesPanel, ScreenshotBrowser, and large list projections. |
| Benchmark coverage | Existing tests mostly cover local UI responsiveness or source contracts, not route query counts, payload budgets, SSE amplification, in-flight coalescing under pressure, or idle-timeout semantics. New route-hotspot and overlay-live-pressure benchmarks are needed before large semantic rewrites. |

## Verification Results

| Command | Result |
| --- | --- |
| `bun test packages/opencorvus/test/session/session-tree.test.ts --timeout 30000` | Pass: 2 tests. |
| `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "conversation/session" --timeout 30000` | Pass: 3 tests, 16 filtered. |
| `bun test packages/opencorvus/test/server/log-routes.test.ts --timeout 30000` | Pass: 8 tests. |
| `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/diff-change-groups.test.ts --timeout 30000` | Pass: 5 tests. |
| `bun run --cwd packages/opencorvus typecheck` | Pass. |
| `bun run --cwd packages/overlay typecheck` | Pass. |
| `git diff --check` | Pass. |

## Deferred Root Causes

These are confirmed investigation results but were not patched in this pass because they need equivalence fixtures and query/payload budgets before changing semantics:

| Deferred item | Reason not changed in this pass |
| --- | --- |
| Task list `taskItems(...)` batch projection | High impact but must preserve active plan/run/evaluation/interactions/session fields exactly while removing per-task fan-out. |
| `/task/:id/conversation/history` bounded pagination | Current route merges multi-session messages, control timeline, and protocol events; replacing full transcript reads without fixtures risks cursor/lifecycle regressions. |
| Status route lean projection | Needs route-specific query budget tests to avoid removing fields still required by mission/status consumers. |
| Provider catalog payload trimming | API and SDK contract change; requires explicit provider response design. |
| Browser-preview target probing/evidence scan | Candidate reachability semantics are broad; only inactive overlay triggering was narrowed here. |
| InteractionDialogHost/usage/agent rail/Board projection indexes | Should be handled by store-level single-source projections, not local caches in each component. |
