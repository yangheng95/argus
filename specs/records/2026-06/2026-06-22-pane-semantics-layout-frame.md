# Pane Semantics Layout Frame

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- DOM: Document Object Model, the browser element tree.
- ARIA: Accessible Rich Internet Applications, the attributes exposed to assistive technologies.

## Task Definition

Continue the overlay resize performance audit by removing pane geometry reads
from the same frame callback that applies window resize zoom writes, and by
removing pane semantics geometry reads after pane width style writes.

## Recall

| Source                                                | Constraint carried forward                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                           | No fallback, no duplicate layout source, no blind patching, test every change, visually verify GUI work, and commit/push every round.             |
| `2026-06-03-resize-observer-frame-coalescing-plan.md` | Resize-driven layout work must not run synchronously in high-frequency browser delivery paths.                                                    |
| `2026-06-17-left-pane-resizer-accessibility.md`       | Pane handle semantics belong in `services/pane.ts`; do not add a second ARIA writer in `main.tsx`.                                                |
| `2026-06-22-overlay-resize-frame-coalescing.md`       | Window resize work is coalesced through the shared RAF scheduler.                                                                                 |
| `2026-06-22-window-resize-center-layout-frame.md`     | Center workbench geometry reads were moved out of the resize style-write callback; pane service internals were explicitly left for a later audit. |
| `2026-06-22-left-pane-drag-frame-coalescing.md`       | Pointer drag work is already coalesced; `resizePane()` still uses pane service math and renderer as the single source.                            |

## Call Point Inventory

| Surface                | Evidence                                                                                                                                                                                                     | Decision                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Window resize event    | `main.tsx` has the only `window.addEventListener("resize", applyWindowResizeOnFrame.schedule)` and `visualViewport.resize` path.                                                                             | Keep the existing event path and scheduler.                                                                                                                                             |
| Window resize callback | `applyWindowResize()` calls `applyZoom()`, `renderPaneLayout(paneCallbacks.getState(), PANEL_PANE_CONFIG)`, then schedules center workbench layout.                                                          | Keep one pane service renderer, but schedule pane layout after the zoom write frame.                                                                                                    |
| Pane renderer          | `renderPaneLayout()` reads pane width inputs, writes `--ui-sidebar-width` and `--ui-sections-width`, then calls `renderPaneHandleSemantics()`.                                                               | Keep `renderPaneLayout()` as the single public renderer, but defer handle semantics to the pane service's own shared RAF so no geometry read follows pane CSS writes in the same frame. |
| Pane semantics         | `renderPaneHandleSemantics()` calls `paneResizeBounds()`, which reads `#panelBody.getBoundingClientRect()` and handle widths.                                                                                | Keep one semantics implementation, but run it after pane width writes have had a frame boundary.                                                                                        |
| Pointer drag           | `resizePane()` reads bounds before writing CSS; pointermove is already RAF-coalesced and pointerup flushes the last pending point.                                                                           | Keep drag math; deferred semantics means drag no longer reads handle bounds after writing CSS in the same callback.                                                                     |
| Keyboard resize        | `resizePaneByKeyboard()` reads bounds before writing CSS and persists widths.                                                                                                                                | Keep immediate keyboard width application; ARIA values update on the next pane semantics RAF.                                                                                           |
| Programmatic widths    | `applyPaneWidths()` calls `renderPaneLayout()` and persists through the existing callback.                                                                                                                   | Preserve this API; semantics update remains owned by `renderPaneLayout()`.                                                                                                              |
| Tests                  | `pane-config.test.ts` and `left-pane-resizer-browser.test.ts` already guard pane ownership and pointermove coalescing. `center-workbench-separator-browser.test.ts` only checks center workbench rect reads. | Extend pane tests and browser instrumentation to prove pane rect reads do not share resize style-write frames.                                                                          |

## Root Cause

The previous window resize repair moved the center workbench geometry read out
of the resize style-write callback, but `applyWindowResize()` still writes
`--ui-scale` and then calls `renderPaneLayout()` in the same RAF callback.
Pane layout calculation reads pane body and handle geometry before writing pane
CSS variables. After those pane CSS writes, `renderPaneLayout()` immediately
enters `renderPaneHandleSemantics()`, which reads the pane body and handle
rectangles again through `paneResizeBounds()` and `paneHandleWidth()`. During
live resize, the callback therefore still contains write-read-write-read layout
pressure on the pane side, which can force layout and keep the overlay feeling
stuck.

## Fix Plan

1. Keep `renderPaneLayout()` as the only public pane layout and ARIA entry point.
2. Add a single `main.tsx` RAF scheduler that invokes `renderPaneLayout()` for
   the current pane state after the resize zoom frame.
3. Add a pane-service-owned shared RAF scheduler for handle semantics.
4. Change `renderPaneLayout()` to write pane CSS variables immediately and queue
   the latest pane semantics state through that scheduler.
5. Flush all queued pane semantics states in the scheduler callback, using the
   existing `renderPaneHandleSemantics()` implementation.
6. Extend static tests to forbid direct `renderPaneHandleSemantics()` execution
   inside `renderPaneLayout()`.
7. Extend the real browser left-pane test so viewport resize instrumentation
   tracks pane style writes, pane rect reads, and ARIA writes by frame and
   sequence.
8. Capture visual screenshots after desktop, narrow, and restored viewport
   resize states.

## Acceptance

- `renderPaneLayout()` remains the single pane layout API used by `main.tsx`,
  `applyPaneWidths()`, pointer drag, keyboard resize, and initial mount.
- Pane handle semantics still have one implementation in `services/pane.ts`.
- Browser instrumentation shows no pane body/handle geometry read after resize
  or pane style writes in the same RAF callback.
- Pointer drag remains coalesced and still flushes the final pending pointer
  position before persistence.
- Keyboard resize still changes visible width and exposes updated ARIA values
  after the scheduled semantics frame.
- Focused unit tests, real browser test, overlay typecheck, visual screenshots,
  self-review, commit, and push all pass.

## Verification Plan

- `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`
- Visual QA of the screenshots written by the browser test.

## Verification

- `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/acceptance-panel-mount.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`

## Visual Review

- `.scratch/left-pane-resizer-accessibility.png`: desktop layout remains coherent after keyboard and pointer resizing; left separator focus is visible and the right toolbar remains aligned.
- `.scratch/left-pane-resizer-desktop-resize.png`: desktop viewport resize keeps the left pane separator and side activity toolbar in the expected positions.
- `.scratch/left-pane-resizer-compact-resize.png`: compact viewport hides the pane separator and switches the right activity toolbar to the bottom rail; this screenshot also exposes a separate titlebar narrow-width text overlap to handle in a later round.
- `.scratch/left-pane-resizer-restored-desktop-resize.png`: restored desktop viewport brings the left pane separator back without layout drift.

## Self Review

- `applyWindowResize()` now writes zoom and schedules pane layout through `renderPaneLayoutOnFrame`, so pane geometry reads no longer share the `--ui-scale` resize write frame.
- `renderPaneLayout()` remains the single public pane layout API, writes pane CSS variables, and schedules handle semantics through the pane service's private RAF scheduler.
- `renderPaneHandleSemantics()` remains the only ARIA implementation for pane handles; no `main.tsx` ARIA writer or fallback path was added.
- The browser benchmark first failed on same-frame pane write/read evidence, then passed after the scheduler split.
