# Center Workbench Frame Phase Split

Date: 2026-06-23
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- RAF: Request Animation Frame, the browser frame callback used for visual work.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Keep center workbench toolbar-open and window-resize interactions responsive by
separating layout-affecting style writes from geometry reads and reveal
scrolling. This continues the legal aspect-ratio and minimum panel width work:
no panel may rely on an illegal compressed size, and no resize path should force
layout in the same frame where it writes panel grow styles.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no double source, no blind patching, test every change, visually verify UI work, commit and push each round. |
| `2026-06-22-overlay-layout-aspect-frame.md` | Legal overlay size is derived from the `1120x720` minimum tokens; do not restore native live resize feedback loops. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | `--ui-workbench-panel-min-width` remains the only center panel minimum width source; constrained layouts scroll instead of compressing panels. |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Separator range writes must refuse impossible adjacent widths; no emergency smaller minimum is allowed. |
| `2026-06-23-overlay-ui-asset-fingerprint.md` | Live 7878 may serve stale UI assets; verify runtime asset fingerprints before trusting GUI performance observations. |
| Live 7878 read-only check | `/ui/index.html` serves `assets/index-CO3SwO-J.js` and `assets/index-DlM3OgGm.css`, lacks fingerprint headers, while disk `dist-vite` serves `assets/index-wUOtBkqV.js` and `assets/index-CUXXiPYE.css`. |
| Read-only agent audits | Current source still writes `--center-workbench-panel-grow`, then reads separator rects and calls `scrollIntoView()` in the same RAF callback. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Panel open/reset | `resetCenterWorkbenchToFocusedPanel()` and `openCenterWorkbenchPanel()` call `scheduleCenterWorkbenchPanelReveal()`. | Keep one reveal request path. It should schedule the write frame, not call `scrollIntoView()` directly. |
| Panel DOM state effect | The `centerWorkbenchPanels()` effect writes `data-open`, `data-active`, and `data-selected`, then schedules layout. | Keep DOM state writes synchronous and defer layout work to RAF. |
| Panel grow writes | `renderCenterWorkbenchPanelWeights()` writes/removes `--center-workbench-panel-grow`. | Keep this as the only panel grow style owner, but isolate it in a write frame. |
| Separator geometry reads | `renderCenterWorkbenchPanelSeparators()` calls `centerWorkbenchPanelResizeMetrics()`, which reads `getBoundingClientRect()`. | Move separator reads to a following RAF frame after grow writes have committed. |
| Reveal scrolling | `revealPendingCenterWorkbenchPanel()` calls `scrollIntoView()`. | Run reveal with the separator read phase, not in the grow write phase. |
| Settings weight changes | The settings effect currently calls `untrack(renderCenterWorkbenchPanelLayout)`. | Replace direct layout execution with the same staged scheduler. |
| Window resize | `applyWindowResize()` schedules pane layout and center workbench layout. | Keep frame coalescing; center workbench writes and reads must not share a frame. |
| Pointer/keyboard separator resizing | `updateCenterWorkbenchPanelWeights()` is the single weight mutation path. | Keep it; layout updates still flow through settings and the staged scheduler. |
| Browser test instrumentation | `center-workbench-separator-browser.test.ts` tracks `--ui-scale` and `--ui-sidebar-width` writes, but not `--center-workbench-panel-grow`. | Extend instrumentation so the old same-frame grow-write/rect-read path fails. |
| Static tests | `resize-observer-frame-scheduler.test.ts`, `acceptance-panel-mount.test.ts`, and `browser-preview-panel.test.ts` assert current scheduler names. | Update tests to assert the split write/read scheduler contract. |

## Root Cause

The current source already avoids the earlier click-task synchronous layout
work: panel open and window resize schedule center workbench layout through RAF.
However, the RAF callback itself still performs two phases together:

1. write `--center-workbench-panel-grow` on open center panels;
2. read separator geometry through `getBoundingClientRect()` and reveal the
   target panel with `scrollIntoView()`.

That is a same-frame write-then-read sequence. With multiple legal-min-width
panels open, a screenshot or browser preview panel mounting, and a viewport
resize happening nearby, Chromium can be forced to resolve layout inside the
interaction frame. The stale live bundle explains the current 7878 user-facing
slowness, but this source path is still a real current-bundle risk.

## Fix Plan

1. Keep `renderCenterWorkbenchPanelWeights()` as the single panel grow writer.
2. Split center workbench rendering into a write frame and a measure/reveal
   frame using the existing `createAnimationFrameScheduler`.
3. Route panel opens, settings weight changes, and window resize through the
   write-frame scheduler.
4. Cancel both pending frame schedulers during module teardown.
5. Extend static tests so direct same-frame layout and reveal are rejected.
6. Extend the browser separator test instrumentation to count
   `--center-workbench-panel-grow` as a layout write and wait long enough to
   observe the following read frame.
7. Run focused tests, browser visual tests, inspect generated screenshots,
   self-review, commit, and push.

## Acceptance

- `--center-workbench-panel-grow` writes and center workbench rect reads never
  happen in the same RAF frame during toolbar open or viewport resize.
- `scrollIntoView()` reveal runs after the grow write frame, not in it.
- Center workbench panel minimum width and aspect-ratio contracts remain
  unchanged and token-owned.
- No debounce, fallback size, alternate panel state, or duplicate geometry
  source is introduced.
- Focused static tests, browser tests, visual QA, typecheck, self-review,
  commit, and push pass.

## Verification

- PASS: `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/browser-preview-panel.test.ts --timeout 30000`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- PASS: `bun test packages/overlay/test/center-workbench-size.test.ts packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/overlay-window-size-contract.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.
- Live 7878 read-only fingerprint check still shows the running process is old:
  no `X-Opencorvus-Overlay-Ui-Source`, no
  `X-Opencorvus-Overlay-Ui-Assets`, and served assets
  `assets/index-CO3SwO-J.js,assets/index-DlM3OgGm.css` while disk
  `dist-vite` serves `assets/index-wUOtBkqV.js,assets/index-CUXXiPYE.css`.
- Visual QA reviewed:
  `.scratch/center-workbench-three-panel-min-width.png`,
  `.scratch/center-workbench-three-panel-min-width-1120.png`,
  `.scratch/center-workbench-separator-restored-desktop-resize.png`,
  `.scratch/screenshot-browser-panel-browser.png`, and
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`.

## Self Review

- Rechecked `main.tsx`: panel DOM state writes still happen in the
  `centerWorkbenchPanels()` effect, grow style writes happen only in
  `renderCenterWorkbenchPanelWeights()`, and separator rect reads plus
  `scrollIntoView()` now run from `renderCenterWorkbenchPanelMeasurementsAndReveal()`.
- Rechecked the settings weight path: changing
  `centerWorkbenchPanelWeights` schedules the same write-frame owner instead of
  directly executing layout.
- Rechecked browser instrumentation: `--center-workbench-panel-grow` is now
  treated as a layout style write, so the old same-frame grow-write/rect-read
  regression fails the toolbar-open and viewport-resize browser test.
- Rechecked visual evidence: three legal-width panels remain readable at 1280
  and 1120 widths; screenshot pressure rendering and narrow screenshot cards
  remain inside their panel.
