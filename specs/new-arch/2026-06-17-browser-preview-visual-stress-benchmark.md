# Browser Preview Visual Stress Benchmark - 2026-06-17

## Acronyms

- API: Application Programming Interface, the backend contract used by the overlay preview.
- DOM: Document Object Model, the rendered browser tree inspected by Playwright.
- GUI: Graphical User Interface, the visible overlay preview surface.
- HTTP: Hypertext Transfer Protocol, the request/response transport used by preview routes.
- ID: Identifier, a task, target, evidence, or artifact key.
- PNG: Portable Network Graphics, the screenshot image format used for visual evidence.
- SSE: Server-Sent Events, the selected-task event stream that notifies the overlay about preview target updates.
- UI: User Interface, the overlay controls and preview stage.
- URL: Uniform Resource Locator, the persisted browser preview target address.

## Task

Build a repeatable visual stress benchmark for the overlay Browser Preview panel.
The benchmark must exercise the real overlay page, the task-scoped backend preview
routes, live screenshot frames, persisted evidence, target selection, failure
states, and input routing. If it starts an HTTP server, it must bind
`127.0.0.1:7778`; no alternate port is allowed.

## Input And Output

Input:

- Overlay static bundle served by the browser test fixture.
- A fake but route-complete task backend that exposes saved preview targets,
  persisted evidence, live snapshot PNG bytes, live input PNG bytes, task board,
  task conversation, events, and ordinary control-plane routes.
- Scenario mutations for missing target, ready target, stale target switch,
  live snapshot failure, capture failure, persisted viewport evidence, and
  narrow/desktop viewport layouts.
- Selected-task Server-Sent Events (SSE) reconnect before a build-agent preview
  target update.
- Corrupt HTTP 200 live PNG bytes that must render as a visible decode failure,
  not as a broken or blank image.
- A second task with no saved preview target, used to prove stale selection,
  live, and verification state cannot leak across task switches.

Output:

- Node-driven browser benchmark assertions.
- PNG screenshots under `packages/overlay/.scratch/browser-preview-visual-stress/`.
- Request logs proving calls use `task/:taskID/browser-preview...` routes and
  target IDs instead of direct URL bodies.
- A deterministic failure if port `7778` is unavailable.
- A deterministic failure for any unexpected fake-backend route instead of a
  catch-all JSON success.

## Timeout Strategy

The benchmark uses an inactivity-aware wait helper for page conditions. The
helper refreshes its activity marker when observed page state, request count, or
error diagnostics change. It fails after no meaningful activity is observed for
the configured idle window; it does not mechanically count only from process
startup. Node's outer test timeout remains a last-resort process guard.

## Call Point Sweep

Command:

```powershell
rg -n "latestEvidenceIDs|liveImageUrl|liveError|browser-preview-url-form|BrowserPreviewPanel|loadTaskBrowserPreviewTarget|captureTaskBrowserPreviewEvidence|loadTaskBrowserPreviewLiveSnapshotObjectUrl|sendTaskBrowserPreviewLiveInputObjectUrl|selectTaskBrowserPreviewTarget|startBrowserFixture|browser-runner|7778|OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER" packages/overlay packages/opencorvus specs -g "*.ts" -g "*.tsx" -g "*.css" -g "*.md" -g "*.mjs"
```

| Surface                 | Evidence                                                                                                                                                              | Decision                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay panel           | `packages/overlay/src/components/BrowserPreviewPanel.tsx` owns target loading, candidate selection, capture requests, live screenshot object URLs, and input routing. | Keep the backend/evidence-backed design. Bind live image object URLs to task/target/viewport scope so stale frames cannot display or receive input.       |
| Overlay service         | `packages/overlay/src/services/browser-preview.ts` exposes only task-scoped preview routes.                                                                           | Decode live PNG bytes before returning an object URL so corrupt HTTP 200 frames fail visibly instead of entering the DOM image tree. Do not add direct URL or local frame APIs. |
| Backend route           | `packages/opencorvus/src/server/routes/browser-preview.ts` owns target, capture, compare, live snapshot, and live input routes.                                       | Unknown target IDs must fail before capture starts. Live display must remain task/target scoped and must not create evidence.                             |
| Backend target/evidence | `packages/opencorvus/src/browser-preview/target.ts` and `persist.ts` own target selection and latest evidence lookup.                                                 | Preserve `latestEvidenceIDs` per viewport and reject stale evidence by target/viewport in the overlay.                                                    |
| Live sidecar            | `packages/opencorvus/src/browser-preview/live.ts` owns Playwright live PNG frames.                                                                                    | Keep Node sidecar ownership; overlay only displays returned PNG object URLs.                                                                              |
| Evidence runner         | `packages/opencorvus/src/browser-preview/evidence-runner.ts` owns Playwright evidence capture.                                                                        | Do not create another runner in the benchmark.                                                                                                            |
| Browser runner          | `packages/overlay/test/browser-runner.mjs` starts Node browser tests with `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`.                                            | New benchmark must run through this Node path, not Bun Playwright.                                                                                        |
| HTTP fixture            | `packages/overlay/test/browser/http-fixture.ts` currently binds a random port.                                                                                        | Add an explicit port option and use `7778` for this benchmark only. No fallback port.                                                                     |
| Existing E2E tests      | `packages/overlay/test/browser/browser-preview-evidence.test.ts` covers target switch, persisted viewport evidence, live click and wheel.                             | Keep those tests and add broader stress coverage for visual screenshots, failure states, long text, narrow layout, key input, and stale live frame scope. |
| Obsolete CSS            | `packages/overlay/src/styles/surfaces/inspector.css` no longer contains `.browser-preview-url-form` or `.browser-preview-url-input`.                                  | Keep manual URL CSS removed so the backend preview target remains the only rendered source.                                                               |

## Stress Cases

1. Target load failure: a failed `/task/:taskID/browser-preview` request renders
   a visible load-failed state with the backend error detail, no live image, and
   no stale evidence. Refreshing after the backend recovers must continue to the
   authoritative task target state.
2. Missing target: no saved target renders a clear missing state, no live image,
   no evidence screenshot, and no task target is synthesized from message links.
3. Ready target: a backend-owned target opens the preview panel, loads a real
   PNG live frame, shows the persisted target URL, and calls live snapshot with
   `{ targetID, viewportID }`.
4. Fresh live snapshot: repeated live snapshot requests for the same
   task/target/viewport navigate the persisted target URL again, so a changed
   dev server page cannot return a stale cached frame; live input still reuses
   the active page to preserve interaction state.
5. Stale candidate selection: selecting a candidate that the backend now rejects
   with 404 clears pending UI state, renders a visible selection failure, and
   still allows selecting a valid target afterward.
6. Candidate selection: selecting another saved target hides old evidence and
   old live frames before the new live snapshot arrives, then displays only the
   selected target's evidence.
7. Viewport switch: desktop/tablet/mobile persisted evidence is selected by
   `latestEvidenceIDs[viewportID]`, and switching viewports cannot show another
   viewport's evidence.
8. Live input: click, wheel, and keyboard input are sent only after a live frame
   matching the active task/target/viewport is visible, and the returned frame
   must visually match the expected input-response PNG.
9. Live image decode failure: a live snapshot route that returns HTTP 200 but
   supplies corrupt PNG bytes is rejected before an object URL is returned,
   renders the live error state, clears the broken image, and can recover on
   the next active viewport snapshot.
10. Live failure: a first-frame snapshot failure renders the live error state
   before the evidence-missing state and includes the backend error body.
11. Capture failure: failed capture evidence is rendered as failed evidence, not
   as an empty missing preview.
12. Unknown target capture: an unknown capture target fails with 404 instead of
   producing a 200 failed verification body.
13. Layout pressure: desktop and narrow viewports have no incoherent overlap,
   no body-level horizontal overflow, truncated long candidate/status text, and
   nonblank screenshot evidence.
14. Cross-task scope reset: after a candidate selection failure on one task,
   switching to another task must clear selection errors, live screenshots,
   persisted evidence, and verification status before rendering that task's
   own missing/ready/failed preview state.
15. Failed target authority: when the backend reports the selected target as
   `status: failed`, the panel must render the target-failed state and clear
   live/evidence screenshots and stale verification status for that target.
   Capture controls must be disabled until the target is ready again. Persisted
   evidence from an earlier ready state must not mask a now-unreachable preview
   target.
16. Build-agent target persistence: when the preview panel is already showing
   the missing-target state and the backend emits a task-scoped
   `task.updated` event from `browser-preview.target`, the overlay must reload
   the selected board, refetch `/task/:taskID/browser-preview`, and render the
   newly persisted target without a manual refresh click. The benchmark must
   first close the selected-task SSE stream and wait for it to reconnect, then
   deliver the target update. This guards the "build agent started services but
   the Preview panel stayed blank" workflow after a transient live-stream break.

## Acceptance

- `node test/browser-runner.mjs test/browser/browser-preview-visual-stress.test.ts`
  passes and writes screenshots for every visual scenario, including stale
  candidate failure.
- The benchmark proves `task.updated` from `browser-preview.target` refreshes a
  missing preview into a nonblank task-scoped target without manual UI refresh,
  even after the selected-task SSE stream disconnects and reconnects.
- `node --test test/browser/http-fixture-close.test.ts` proves fixture close
  destroys active streaming HTTP connections.
- Targeted source/unit tests pass for preview panel and backend route changes.
- Initial preview target load failures and explicit failed targets render
  visible failed states; neither path is allowed to keep showing stale live or
  persisted evidence, stale verification status, or an enabled capture action.
- Corrupt HTTP 200 live snapshot image bytes are decoded before object URL
  creation, render a visible live decode failure, and clear the broken image
  before recovery.
- Switching tasks after a preview selection failure renders the next task's
  own preview state and leaves no stale selection, live, evidence, or
  verification UI behind.
- The benchmark uses port `7778` with no fallback.
- The overlay never renders iframe, manual URL entry, query override, or local
  preview source behavior for this benchmark.
- Live screenshots are scoped to the current task, target, and viewport.
- Repeated live snapshot requests reload the persisted target URL for fresh
  frames while live input preserves the current page state.
- Fake backend routes fail fast on unexpected paths; no catch-all 200 JSON route
  is allowed.
- Unknown capture target IDs fail before Playwright evidence capture starts.
- Final screenshots are manually reviewed after the benchmark passes.
