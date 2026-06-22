# Overlay Resize Frame Coalescing

Date: 2026-06-22
Status: Implemented

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser API used to run visual work once per frame.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Investigate and repair overlay resize jank while preserving the existing pane and
center workbench resize sources.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate resize owner, test every change, and visually verify UI changes. |
| `2026-06-03-resize-observer-frame-coalescing-plan.md` | Layout-affecting resize work must run outside synchronous observer/event delivery when the browser can emit high-frequency resize signals. |
| `2026-06-07-overlay-workbench-resizable-panels.md` | Center workbench panel weights are the single persisted width source. |
| `2026-06-17-center-workbench-separator-accessibility.md` | Center workbench separators remain the real accessible resize controls. |
| `2026-06-18-right-activity-toolbar-responsive-rail.md` | Right activity toolbar remains the single `SideActivityToolbar` source. |

## Call Point Inventory

| Surface | Current evidence | Decision |
| --- | --- | --- |
| Window resize | `main.tsx` has the only `window.addEventListener("resize", ...)` and `visualViewport.resize` path. | Keep one listener path, but schedule its layout work through the shared RAF scheduler. |
| Center workbench drag | `main.tsx` has the only `[data-center-workbench-separator]` pointermove handler. | Keep existing weight source and separator DOM; coalesce drag updates per frame and flush the final pending pointer position on pointerup. |
| Default pane resizer | `services/pane.ts` owns the left/default pane resize service. | Leave unchanged in this round; it is a separate mature service and not the observed window resize path. |
| Tests | `resize-observer-frame-scheduler.test.ts` already guards shared frame scheduling for resize observers; `center-workbench-separator-browser.test.ts` covers real separator resize and screenshots. | Extend the guard to window resize and center workbench drag scheduling, then rerun the real browser separator visual test. |

## Root Cause

The resize symptom comes from high-frequency browser resize and pointermove
events running layout-affecting work synchronously. Window resize calls
`applyZoom`, `renderPaneLayout`, and `renderCenterWorkbenchPanelSeparators` for
every event. Center workbench drag recalculates widths and separator ARIA values
for every pointermove. During live resizing these event streams can exceed the
browser frame budget and make the overlay feel stuck.

## Fix Plan

1. Import and reuse `createAnimationFrameScheduler` in `main.tsx`.
2. Replace direct window resize work with `applyWindowResizeOnFrame.schedule`.
3. Replace direct center workbench pointermove work with a latest-clientX RAF
   batch.
4. On pointerup/cancel, cancel any scheduled drag frame and synchronously apply
   the final pending clientX before persisting weights.
5. Add static tests that forbid direct window resize and center workbench drag
   scheduling regressions.
6. Rerun focused unit tests, overlay typecheck, and the browser separator visual
   test.

## Acceptance

- Window resize work is frame-coalesced through the shared scheduler.
- Center workbench drag keeps one persisted weight source and applies the final
  pointer position before saving.
- Existing keyboard resize remains immediate and accessible.
- No alternate resize owner, fallback layout, hidden toolbar, iframe, or local
  override is introduced.
- Focused tests and browser visual verification pass.
