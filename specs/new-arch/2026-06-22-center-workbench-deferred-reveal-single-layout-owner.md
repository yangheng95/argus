# Center Workbench Deferred Reveal Single Layout Owner

Date: 2026-06-22
Status: Implemented

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser API used to run visual work once per frame.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Remove the remaining immediate layout-affecting work from center workbench panel
open and make center workbench weight changes render from a single owner.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate layout source, test every change, and visually verify UI work. |
| `2026-06-22-overlay-resize-frame-coalescing.md` | High-frequency and layout-affecting work must run through the shared RAF scheduler. |
| `2026-06-22-center-workbench-open-layout-frame.md` | Panel open writes DOM state immediately but schedules layout reads after DOM state writes. |
| `2026-06-07-overlay-workbench-resizable-panels.md` | `centerWorkbenchPanelWeights` remains the only persisted width source. |
| Independent GUI audit 2026-06-22 | `scrollIntoView` and tracked helper calls still leave layout work on the panel-open path. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Panel reveal | `openCenterWorkbenchPanel()` and `resetCenterWorkbenchToFocusedPanel()` queue `scrollIntoView()` in a microtask. | Replace both with one RAF-scheduled reveal helper. |
| Panel open effect | The panel-open effect already schedules `renderCenterWorkbenchPanelLayoutOnFrame.schedule()`. | Keep this as the only open-state layout render path. |
| Settings weight effect | The effect reads `settingsStore.centerWorkbenchPanelWeights` and then calls helpers that read `centerWorkbenchPanels()`. | Track only weights, then render layout inside `untrack(...)`. |
| Drag resize | `applyPendingCenterWorkbenchPanelResize()` updates weights and directly renders separators. | Let the settings-weight effect own post-weight layout. |
| Keyboard resize | `resizeCenterWorkbenchPanelByKeyboard()` updates weights and directly renders weights/separators. | Let the settings-weight effect own post-weight layout while preserving immediate save behavior. |
| Tests | Existing static tests preserve direct `scrollIntoView()` and only check literal panel-count tracking. | Replace those checks with RAF reveal and untracked single-owner guards. |

## Root Cause

The previous panel-open fix moved the explicit separator layout render to RAF,
but two immediate layout paths remained. First, opening a panel still queued
`scrollIntoView()` in a microtask; that operation can force geometry resolution
before the next frame. Second, the settings-weight effect called layout helpers
inside a tracked Solid effect, so helper reads of `centerWorkbenchPanels()` could
subscribe the effect to panel-open state and run separator geometry work
synchronously. Drag and keyboard paths also rendered after updating the same
weight store, leaving two owners for post-weight layout.

## Fix Plan

1. Add one module-level `scheduleCenterWorkbenchPanelReveal()` backed by
   `createAnimationFrameScheduler`.
2. Replace panel-open and focused-panel reset microtask reveal calls with the
   scheduler.
3. Change the settings-weight effect to track only
   `settingsStore.centerWorkbenchPanelWeights` and call
   `untrack(renderCenterWorkbenchPanelLayout)`.
4. Remove direct post-weight layout renders from drag and keyboard resize paths.
5. Update static architecture tests and add browser instrumentation that proves
   screenshot toolbar open does not call `scrollIntoView()` before RAF.
6. Rerun focused unit/static tests, overlay typecheck/build, and real browser
   screenshot/center-workbench visual tests.

## Acceptance

- Panel open does not call `queueMicrotask(...scrollIntoView...)`.
- Center workbench panel reveal happens through the shared RAF scheduler.
- The settings-weight effect does not subscribe to panel-open state through
  layout helpers.
- Drag and keyboard resize keep `centerWorkbenchPanelWeights` as the single
  persisted source and do not directly duplicate post-weight layout renders.
- No fallback toolbar, alternate panel state, iframe, or hidden UI source is introduced.

## Verification

- `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`
- `bun test packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/browser-preview-panel.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`
- `bun run --cwd packages/overlay check:i18n`
- Visual QA: viewed `.scratch/screenshot-browser-panel-browser.png`,
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`, and
  `.scratch/center-workbench-separator-focus.png`; screenshot thumbnails,
  narrow panel clipping, toolbar state, and center separator focus/resize layout
  remain correct.

## Self Review

- Rechecked `openCenterWorkbenchPanel()` and
  `resetCenterWorkbenchToFocusedPanel()`; both now call
  `scheduleCenterWorkbenchPanelReveal()` instead of queuing a microtask
  `scrollIntoView()`.
- Rechecked the settings-weight effect; it tracks the deterministic
  `centerWorkbenchPanelWeightsSignature()` and runs
  `untrack(renderCenterWorkbenchPanelLayout)`, so helper reads of
  `centerWorkbenchPanels()` do not subscribe it to panel-open state.
- Rechecked drag and keyboard resize paths; they update
  `centerWorkbenchPanelWeights` and rely on the weight effect, so
  post-weight layout has one owner.
- The first center browser rerun exposed that reading only the weight object did
  not reliably track per-panel changes; the implemented signature tracks each
  known panel weight directly and the browser resize test now passes.
