# Task List Refresh Unhandled Rejection

Date: 2026-06-23
Status: Verified

## Acronyms

- CDP: Chrome DevTools Protocol, the browser automation and inspection channel used by Playwright.
- GUI: Graphical User Interface, the visible overlay surface.
- SSE: Server-Sent Events, the long-lived task update stream used by the overlay.
- UI: User Interface, visible controls and interaction surfaces.

## Task Definition

Continue the overlay GUI performance investigation on the live `7878` panel.
Toolbar clicks, screenshot browsing, and resize work must remain responsive and
must not be polluted by duplicate runtime error toasts from handled task-list
refresh failures.

## Recall

| Source                                            | Constraint carried forward                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                       | No fallback logic, no blind patching, test every change, visually verify UI work, and commit/push every round.                                                                                                                                                          |
| `2026-06-09-task-list-timeout-index-fix.md`       | `global/tasks` timeout was previously traced to backend query/index cost; do not raise request timeouts.                                                                                                                                                                |
| `2026-06-15-task-list-lean-projection.md`         | Task-list refreshes must stay lean and first-page sized; do not move full selected-task payloads into the list path.                                                                                                                                                    |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Resize and toolbar-open work must respect legal panel sizes and remain frame-owned.                                                                                                                                                                                     |
| Live 7878 evidence                                | Clicking the right `inspector` toolbar while the screenshots panel was open timed out through CDP after 3 seconds; console showed `[task-list-sse] periodic task refresh failed TimeoutError: signal timed out`, and the visible toast read `Error / signal timed out`. |

## Call Point Inventory

| Surface                            | Evidence                                                                                           | Decision                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Global runtime error reporting     | `main.tsx` listens for `window.unhandledrejection` and reports it as a persistent error toast.     | Keep; it is the correct owner for true unhandled failures.                                                                                |
| Periodic task-list refresh         | `services/sse.ts::startTaskListRefreshTimer()` already calls `loadTasks().catch(...)`.             | Keep; this path handles refresh failures and leaves `boardStore.tasksError` as the inline task-list surface.                              |
| SSE task-list notification refresh | `services/events.ts::scheduleTasksCompat()` does `void loadTasks()` with no rejection handler.     | Fix this single scheduler so task-list refresh failures are handled at the task-list refresh owner instead of escaping as runtime errors. |
| Task-list store error state        | `store/board.ts::loadTasksOnce()` sets `boardStore.tasksError` and rethrows.                       | Keep; the retryable task-list error UI remains the explicit surface.                                                                      |
| Toolbar layout                     | Right toolbar buttons open center workbench panels and schedule layout frame owners.               | Do not add a toolbar gate or timeout workaround; remove the unrelated unhandled rejection noise first.                                    |
| Tests                              | `events-refresh.test.ts` already covers task-list notification reloads and single-flight behavior. | Extend it with a rejecting transport to assert the scheduled refresh is caught and recorded, not promoted to an unhandled rejection.      |

## Root Cause

`handleTaskListNotification()` debounces task-list SSE notifications through
`scheduleTasksCompat()`. That scheduler calls `void loadTasks()` without a
rejection handler. When the backend task-list request times out, `loadTasks()`
correctly stores `boardStore.tasksError` and rethrows so direct callers can
react. But this fire-and-forget SSE scheduler has no caller, so the rejection
reaches `window.unhandledrejection`; `main.tsx` then turns it into a persistent
runtime toast.

The visible symptom overlaps user operations: the right toolbar click that
should switch panels hit a 3-second CDP wait, while the panel was also rendering
the timeout toast and stale task-list error state. The fix is not a longer
request timeout or a toolbar gate. The refresh failure is already represented in
the task list; the background scheduler must own its rejection.

## Fix Plan

1. Add a single task-list refresh error handler used by `scheduleTasksCompat()`.
2. Preserve `loadTasks()` semantics: direct callers still receive rejections,
   and `boardStore.tasksError` remains the source for retry UI.
3. Add a regression test that simulates a failed SSE-triggered task-list
   refresh and proves it does not create an unhandled rejection.
4. Run focused tests, overlay typecheck, browser visual test, live visual
   screenshot review, self-review, commit, and push.

## Acceptance

- SSE task-list notification refresh failures no longer escape as
  `window.unhandledrejection`.
- `boardStore.tasksError` still receives the failure message for the task-list
  inline retry UI.
- Direct `loadTasks()` callers keep their existing rejection contract.
- No timeout extension, fallback path, hidden toolbar gate, or duplicate task
  list source is introduced.
- Live/visual QA includes the 7878 evidence and a post-fix screenshot from the
  focused browser test.

## Verification

- PASS: `bun test packages/overlay/test/events-refresh.test.ts --timeout 30000`.
- PASS: `bun test packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/runtime-diagnostics-source.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/goal-7878-current.png`,
  `.scratch/goal-7878-after-inspector-timeout.png`, and
  `.scratch/side-activity-toolbar-illegal-narrow-legal-frame.png`.

## Self Review

- Rechecked call points: periodic task-list refresh already had a `.catch`;
  only `scheduleTasksCompat()` let the `loadTasks()` rejection escape.
- Rechecked product semantics: `loadTasks()` still records
  `boardStore.tasksError` and direct callers still observe failures.
- Rechecked tests: the first focused run exposed stale selected-task recovery
  fixtures that lacked project directory ownership. The fixture now registers
  `CONFIG_REFRESH_DIRECTORY`, and recovery expectations assert the real SSE
  `directory` query.
- Rechecked visual evidence: right activity toolbar remains inside the legal
  frame with no text or control overlap in the browser screenshot.

## Independent Agent Findings

| Agent    | Finding                                                                                                     | Disposition                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Gibbs    | Screenshot thumbnail fetches cannot abort after starting, even though HostTransport supports `AbortSignal`. | Next performance fix candidate; requires API and browser regression coverage.        |
| Gibbs    | Screenshot thumbnails still fetch/decode original large images.                                             | Follow-up after abort support; needs a thumbnail resource source, not a UI fallback. |
| Gibbs    | Existing browser resize tests do not prove the native Windows `WM_SIZING` path.                             | Follow-up benchmark coverage gap.                                                    |
| Beauvoir | `TaskDirBar` breadcrumb still injects raw HTML buttons instead of a Solid component primitive.              | Next UI component reuse candidate.                                                   |
| Beauvoir | TODO/tool activity policy is copied across card-tree helpers, stats, inline renderer, and title projection. | Next double-source cleanup candidate.                                                |
| Beauvoir | `TracePanel` taskID mode is high-confidence dead code.                                                      | Deletion requires user confirmation under `AGENTS.md` rule 17.                       |
