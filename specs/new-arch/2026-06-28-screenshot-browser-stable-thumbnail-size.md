# Screenshot Browser Stable Thumbnail Size

Date: 2026-06-28

## Task Definition

Dragging the right screenshots panel must not make the visible screenshot
thumbnail image grow or shrink. Panel width changes may reflow the number of
columns, but every screenshot card and thumbnail slot must keep a stable
token-owned width for the same UI scale.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback or duplicate source; UI changes require tests and visual screenshot review. |
| `2026-06-14-right-toolbar-screenshot-browser.md` | Screenshot browser derives from card-tree screenshot items and reuses `PreviewableImage`; no second screenshot source. |
| `2026-06-22-screenshot-browser-open-jank.md` | Keep virtualization, lazy thumbnail loading, and bounded attachment requests. |
| `2026-06-22-screenshot-browser-defer-initial-measure.md` | Width measurement stays RAF-scheduled through `ResizeObserver`; no synchronous initial layout read. |
| `2026-06-22-screenshot-browser-virtual-row-measurement.md` | CSS remains the row/card geometry owner; do not reintroduce fixed virtualizer item size. |
| `2026-06-26-right-toolbar-panel-initial-max-width.md` | Right toolbar panels have an initial width cap that is removed by explicit resize; screenshot layout must remain stable across both states. |

## Call Point Inventory

| Area | File | Decision |
| --- | --- | --- |
| Column calculation | `packages/overlay/src/components/ScreenshotBrowserPanel.tsx` | Rename the width token from min width to fixed card width and use it for column count. |
| CSS grid geometry | `packages/overlay/src/styles/surfaces/activity.css` | Replace `1fr` stretched tracks with fixed `--screenshot-browser-card-width` tracks. |
| Static coverage | `packages/overlay/test/screenshot-browser-panel.test.ts` | Guard the fixed card-width variable and reject stretched screenshot columns. |
| Browser visual coverage | `packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts` | Assert thumbnail/card dimensions remain stable when the screenshots panel width changes, and keep screenshot artifacts for review. |

## Acceptance

- Dragging or programmatically resizing the screenshots panel changes the number
  of columns or remaining empty space, not the thumbnail/card visual size.
- The thumbnail source remains the existing stored attachment thumbnail variant.
- No new screenshot source, local cache, iframe, fallback path, or non-RAF
  measurement path is introduced.
- Focused static test and screenshot browser browser test pass.
- Visual artifacts are reviewed after the browser test.
