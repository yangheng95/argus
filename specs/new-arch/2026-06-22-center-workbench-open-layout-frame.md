# Center Workbench Open Layout Frame

Date: 2026-06-22
Status: Implemented

## Acronyms

- DOM: Document Object Model, the browser element tree.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- UI: User Interface, the visible overlay surface.

## Task Definition

Remove the synchronous layout read/write chain from center workbench panel open
and selection updates while preserving the existing panel weight source,
separator semantics, and keyboard resizing behavior.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate layout source, test changes, and visually verify UI work. |
| `2026-06-22-overlay-resize-frame-coalescing.md` | High-frequency or layout-affecting work should be coalesced through the shared RAF scheduler. |
| `2026-06-07-overlay-workbench-resizable-panels.md` | `centerWorkbenchPanelWeights` remains the only persisted panel width source. |
| `2026-06-07-overlay-center-tab-workbench.md` | Center panels are peer panels that share space with the conversation; no tab-strip fallback. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Panel DOM state | `main.tsx` center workbench effect writes `data-open`, `data-active`, and `data-selected`. | Keep immediate state writes so open/selected semantics stay current. |
| Panel grow styles | `renderCenterWorkbenchPanelWeights()` writes `--center-workbench-panel-grow`. | Keep the same function and source, but schedule it after DOM state writes on panel open. |
| Separator state | `renderCenterWorkbenchPanelSeparators()` reads `getBoundingClientRect()` and writes ARIA/hidden state. | Keep the same function and source, but avoid calling it synchronously from panel open. |
| Settings weight updates | A separate effect tracks `settingsStore.centerWorkbenchPanelWeights` and re-renders weights/separators. | Keep direct settings-driven updates for drag and keyboard resize; remove the panel-count dependency so panel open does not double-render. |
| Existing resize/drag | Window resize and pointer drag already use `createAnimationFrameScheduler`. | Reuse the same scheduler utility; do not add a new timing abstraction. |

## Root Cause

Opening toolbar panels mutates the workbench DOM and immediately calls
`renderCenterWorkbenchPanelSeparators()`, which reads panel rectangles in the
same task. That write-then-read chain forces synchronous layout during a user
click. A second settings effect also subscribed to `centerWorkbenchPanels().length`,
so panel open could run the same layout render twice.

## Fix Plan

1. Add `renderCenterWorkbenchPanelLayout()` as the single combined call to panel
   weights and separators.
2. Add `renderCenterWorkbenchPanelLayoutOnFrame` using the existing
   `createAnimationFrameScheduler`.
3. Replace panel open/selection effect direct layout calls with
   `renderCenterWorkbenchPanelLayoutOnFrame.schedule()`.
4. Remove `centerWorkbenchPanels().length` from the settings-weight effect so
   panel open has one scheduled layout pass.
5. Extend `resize-observer-frame-scheduler.test.ts` to guard against synchronous
   panel-open layout reads.
6. Rerun focused unit/typecheck/build plus the real browser center workbench
   separator visual test.

## Acceptance

- Panel open writes DOM state immediately but schedules weights/separators to RAF.
- `centerWorkbenchPanelWeights` remains the only persisted width source.
- Existing drag and keyboard resize behavior remains intact.
- No alternate toolbar, iframe, gate, fallback layout, or duplicate panel state is introduced.

## Verification

- `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/acceptance-panel-mount.test.ts --timeout 30000`
- Visual QA: viewed `.scratch/center-workbench-separator-focus.png`; inspector panel open, separator focus, right toolbar, and center workbench layout remain aligned without clipping.

## Self Review

- Rechecked all `renderCenterWorkbenchPanelWeights()` and `renderCenterWorkbenchPanelSeparators()` call sites in `main.tsx`.
- Verified panel open now only schedules `renderCenterWorkbenchPanelLayoutOnFrame.schedule()` after DOM state writes.
- Verified the settings-weight effect no longer subscribes to `centerWorkbenchPanels().length`, so panel open has one scheduled layout pass instead of a synchronous duplicate.
