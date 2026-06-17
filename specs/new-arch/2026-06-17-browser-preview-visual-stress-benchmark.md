# Browser Preview Visual Stress Benchmark - 2026-06-17

## Acronyms

- API: Application Programming Interface, the backend contract used by the overlay preview.
- DOM: Document Object Model, the rendered browser tree inspected by Playwright.
- GUI: Graphical User Interface, the visible overlay preview surface.
- ID: Identifier, a task, target, evidence, or artifact key.
- PNG: Portable Network Graphics, the screenshot image format used for visual evidence.
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

Output:

- Node-driven browser benchmark assertions.
- PNG screenshots under `packages/overlay/.scratch/browser-preview-visual-stress/`.
- Request logs proving calls use `task/:taskID/browser-preview...` routes and
  target IDs instead of direct URL bodies.
- A deterministic failure if port `7778` is unavailable.

## Timeout Strategy

The benchmark uses an inactivity-aware wait helper for page conditions. The
helper refreshes its activity marker when observed page state, request count, or
error diagnostics change. It fails after no meaningful activity is observed for
the configured idle window; it does not mechanically count only from process
startup. Node's outer test timeout remains a last-resort process guard.

## Call Point Sweep

Command:

```powershell
rg -n "latestEvidenceIDs|liveImageUrl|liveError|browser-preview-url-form|BrowserPreviewPanel|loadTaskBrowserPreviewTarget|captureTaskBrowserPreviewEvidence|loadTaskBrowserPreviewLiveSnapshotObjectUrl|sendTaskBrowserPreviewLiveInputObjectUrl|selectTaskBrowserPreviewTarget|startBrowserFixture|browser-runner|7778|OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER" packages/overlay packages/opencorvus specs -g "*.ts" -g "*.tsx" -g "*.md" -g "*.mjs"
```

| Surface | Evidence | Decision |
| --- | --- | --- |
| Overlay panel | `packages/overlay/src/components/BrowserPreviewPanel.tsx` owns target loading, candidate selection, capture requests, live screenshot object URLs, and input routing. | Keep the backend/evidence-backed design. Bind live image object URLs to task/target/viewport scope so stale frames cannot display or receive input. |
| Overlay service | `packages/overlay/src/services/browser-preview.ts` exposes only task-scoped preview routes. | Keep unchanged unless a route contract changes; do not add direct URL or local frame APIs. |
| Backend route | `packages/opencorvus/src/server/routes/browser-preview.ts` owns target, capture, compare, live snapshot, and live input routes. | Unknown target IDs must fail before capture starts. Live display must remain task/target scoped and must not create evidence. |
| Backend target/evidence | `packages/opencorvus/src/browser-preview/target.ts` and `persist.ts` own target selection and latest evidence lookup. | Preserve `latestEvidenceIDs` per viewport and reject stale evidence by target/viewport in the overlay. |
| Live sidecar | `packages/opencorvus/src/browser-preview/live.ts` owns Playwright live PNG frames. | Keep Node sidecar ownership; overlay only displays returned PNG object URLs. |
| Evidence runner | `packages/opencorvus/src/browser-preview/evidence-runner.ts` owns Playwright evidence capture. | Do not create another runner in the benchmark. |
| Browser runner | `packages/overlay/test/browser-runner.mjs` starts Node browser tests with `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`. | New benchmark must run through this Node path, not Bun Playwright. |
| HTTP fixture | `packages/overlay/test/browser/http-fixture.ts` currently binds a random port. | Add an explicit port option and use `7778` for this benchmark only. No fallback port. |
| Existing E2E tests | `packages/overlay/test/browser/browser-preview-evidence.test.ts` covers target switch, persisted viewport evidence, live click and wheel. | Keep those tests and add broader stress coverage for visual screenshots, failure states, long text, narrow layout, key input, and stale live frame scope. |
| Obsolete CSS | `packages/overlay/src/styles/surfaces/inspector.css` still contains `.browser-preview-url-form` and `.browser-preview-url-input`. | Record as deprecated manual URL UI residue. Delete only with explicit approval or if the current fix must touch the same contract. |

## Stress Cases

1. Missing target: no saved target renders a clear missing state, no live image,
   no evidence screenshot, no empty candidate or viewport controls, and no task
   target is synthesized from message links.
2. Ready target: a backend-owned target opens the preview panel, loads a real
   PNG live frame, shows the persisted target URL, and calls live snapshot with
   `{ targetID, viewportID }`.
3. Candidate selection: selecting another saved target hides old evidence and
   old live frames before the new live snapshot arrives, then displays only the
   selected target's evidence.
4. Viewport switch: desktop/tablet/mobile persisted evidence is selected by
   `latestEvidenceIDs[viewportID]`, and switching viewports cannot show another
   viewport's evidence.
5. Live input: click, wheel, and keyboard input are sent only after a live frame
   matching the active task/target/viewport is visible.
6. Live failure: a first-frame snapshot failure renders the live error state
   before the evidence-missing state and includes the backend error body.
7. Capture failure: failed capture evidence is rendered as failed evidence, not
   as an empty missing preview.
8. Unknown target capture: an unknown capture target fails with 404 instead of
   producing a 200 failed verification body.
9. Layout pressure: desktop and narrow viewports have no incoherent overlap,
   no body-level horizontal overflow, truncated long candidate/status text, and
   nonblank screenshot evidence.

## Acceptance

- `node test/browser-runner.mjs test/browser/browser-preview-visual-stress.test.ts`
  passes and writes screenshots for every visual scenario.
- Targeted source/unit tests pass for preview panel and backend route changes.
- The benchmark uses port `7778` with no fallback.
- The overlay never renders iframe, manual URL entry, query override, or local
  preview source behavior for this benchmark.
- Live screenshots are scoped to the current task, target, and viewport.
- Unknown capture target IDs fail before Playwright evidence capture starts.
- Final screenshots are manually reviewed after the benchmark passes.
