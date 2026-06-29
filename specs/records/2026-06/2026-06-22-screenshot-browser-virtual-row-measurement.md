# Screenshot Browser Virtual Row Measurement

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- CSS: Cascading Style Sheets, the stylesheet language that owns the panel's visual geometry.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.

## Task Definition

Remove the remaining screenshot browser virtual-list geometry mismatch that can
make screenshot toolbar open and viewport resize feel sticky after the previous
data-source and request-budget fixes.

## Recall

| Source                                                   | Constraint carried forward                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                              | No fallback, no gate, no duplicate source, recall before edits, test every change, visually verify UI changes, commit and push every round.                             |
| `2026-06-14-right-toolbar-screenshot-browser.md`         | Screenshot browser must derive from task card/message data and reuse `PreviewableImage`; no second screenshot source, local storage, iframe, or direct object URL path. |
| `2026-06-22-screenshot-browser-open-jank.md`             | Rendering is virtualized, thumbnails lazy-load, and attachment requests stay bounded.                                                                                   |
| `2026-06-22-screenshot-browser-defer-initial-measure.md` | Screenshot list width measurement is already RAF-scheduled; do not add synchronous layout reads.                                                                        |
| `2026-06-22-screenshot-browser-top-level-index.md`       | `ScreenshotBrowserPanel` must read `cardTreeStore.screenshotItems`, not `order` or `cards`.                                                                             |
| `2026-06-22-window-resize-center-layout-frame.md`        | Window resize and center workbench layout already have single RAF owners; do not add a second resize owner.                                                             |

## Call Point Inventory

| Surface                        | Evidence                                                                                                                                                                   | Decision                                                                                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScreenshotBrowserPanel.tsx`   | Defines `ESTIMATED_SCREENSHOT_BROWSER_ROW_HEIGHT = 152` and passes it as `itemSize` to `Virtualizer`.                                                                      | Remove the fixed hint so the mature `virtua` measurement engine estimates from actual measured rows.                                              |
| `activity.css`                 | Card, thumbnail, body, group header, virtual item padding, and gaps all scale through `--ui-scale` and content.                                                            | Keep CSS as the visual geometry owner; do not duplicate row height arithmetic in TypeScript.                                                      |
| `virtua/solid`                 | Local type docs state `itemSize` is optional, and omitting it is recommended for most cases because initial item sizes are automatically estimated from measured sizes.    | Use the library's measurement path instead of a stale fixed number.                                                                               |
| `buildScreenshotBrowserRows()` | Produces group rows and item rows with different heights.                                                                                                                  | Keep row model and grouping unchanged; only remove the bad initial estimate.                                                                      |
| Browser benchmark              | `screenshot-browser-panel-browser.test.ts` already opens 120 screenshots, instruments RAF layout reads, resizes viewport, scrolls to oldest row, and captures screenshots. | Extend it to cover high UI scale before/after resize and prove row virtualization still reaches oldest rows without full request materialization. |
| Static tests                   | `screenshot-browser-panel.test.ts` pins source ownership, virtualization, RAF measurement, CSS layout, and forbidden direct fetch/storage paths.                           | Add guards that no fixed screenshot row-height `itemSize` remains and that CSS remains the geometry source.                                       |

## Root Cause

The screenshot browser now has the correct data source, bounded screenshot
history, virtualized rendering, lazy thumbnail loading, and deferred width
measurement. The remaining geometry defect is that the virtualizer receives a
hard-coded row-height hint of `152`, while real row heights are owned by CSS and
vary by row kind, `--ui-scale`, gap, thumbnail height, body content, and virtual
item padding. During toolbar open and viewport resize, the virtualizer starts
from a stale geometry model, then corrects after measurement; that mismatch can
cause scroll-size churn and delayed visual settling.

## Fix Plan

1. Remove `ESTIMATED_SCREENSHOT_BROWSER_ROW_HEIGHT` from `ScreenshotBrowserPanel`.
2. Remove the `itemSize` prop from the screenshot `Virtualizer` only.
3. Keep current RAF width measurement, grouping rows, lazy thumbnail loading,
   `PreviewableImage`, and `cardTreeStore.screenshotItems` source unchanged.
4. Extend `screenshot-browser-panel.test.ts` to reject fixed row-height hints
   in the screenshot panel.
5. Extend the real browser screenshot test with a high-scale resize pass that
   still reaches the oldest screenshot row and keeps attachment requests bounded.
6. Rerun focused tests, overlay typecheck/build, real browser test, and inspect
   desktop/narrow/high-scale screenshots.

## Acceptance

- Screenshot browser no longer passes a fixed unscaled `itemSize` to `virtua`.
- CSS remains the single visual geometry source for screenshot rows and cards.
- Opening screenshots still has zero synchronous list-width reads outside RAF.
- High-scale resize still keeps the panel readable, without horizontal overflow
  or thumbnail/card escape.
- Scrolling still materializes the oldest screenshot row without fetching the
  full 120-image history.
- No alternate screenshot source, toolbar source, layout fallback, local
  storage, iframe, direct fetch, or direct object URL path is introduced.

## Dead Code Note

`ScreenshotBrowserRow.key` is high-confidence dead data today because Solid
`virtua/solid` does not expose a row-key prop comparable to the Svelte adapter.
This round will not delete it without explicit user confirmation; the active
performance bug can be fixed independently by removing the wrong row-size hint.

## Implementation

| Change                                                                                                       | Reason                                                                                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Removed `ESTIMATED_SCREENSHOT_BROWSER_ROW_HEIGHT` from `ScreenshotBrowserPanel`.                             | Eliminates the stale TypeScript row-height source.                                         |
| Removed the screenshot `Virtualizer` `itemSize` prop.                                                        | Lets `virtua/solid` estimate from measured rows, matching its documented recommended path. |
| Kept CSS card, thumbnail, group, gap, and padding geometry unchanged.                                        | CSS remains the visual geometry owner.                                                     |
| Strengthened static tests against fixed screenshot row-size hints.                                           | Prevents reintroducing the double-source row height.                                       |
| Strengthened browser test with `oc_zoom=1.6`, high-scale screenshot artifact, and valid panel crop evidence. | Verifies the fix under the scale where a fixed unscaled estimate is most harmful.          |

## Verification

| Check                                                                                                                  | Result                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `bun test packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`                                      | Passed: 9 tests, 94 assertions.                                                                                          |
| `bun run --cwd packages/overlay typecheck`                                                                             | Passed.                                                                                                                  |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts` | Passed; runner rebuilt overlay `dist-vite` with the existing Vite warnings only.                                         |
| Visual: `.scratch/screenshot-browser-panel-browser-high-zoom.png`                                                      | Passed: high-scale screenshot panel opens with title, count, grouped thumbnails, bottom toolbar, and no visible overlap. |
| Visual: `.scratch/screenshot-browser-panel-browser-narrow.png`                                                         | Passed: high-scale 320px screenshot column stays in the shell without horizontal overflow.                               |
| Visual: `.scratch/screenshot-browser-panel-browser-narrow-panel.png`                                                   | Passed: crop contains screenshot title/count and visible screenshot cards.                                               |

## Self Review

- `ScreenshotBrowserPanel` still reads only `cardTreeStore.screenshotItems` and
  still gates derivation on `active()`.
- `PreviewableImage`, `fetchResourceAsObjectUrl`, lazy `IntersectionObserver`
  loading, and bounded request assertions are unchanged.
- The real browser test still proves screenshot open has no RAF-external list
  `clientWidth` read, initial attachment requests remain under 24, resize under
  32, and scroll under 64.
- The browser artifact crop was corrected after self-review found that the first
  crop captured blank shell space instead of the screenshot panel.
- Follow-up findings: `ScreenshotBrowserRow.key` is high-confidence dead data
  but requires user confirmation before deletion; pane resize may still need a
  dedicated longtask/rect-read benchmark because current center resize tests do
  not cover pane-side `getBoundingClientRect()` reads.
