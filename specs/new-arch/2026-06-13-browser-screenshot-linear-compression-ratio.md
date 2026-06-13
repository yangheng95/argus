# Browser Screenshot Linear Compression Ratio - 2026-06-13

## Problem

The browser screenshot pixel summary currently reports `compressionRatio = currentPixels / compressedPixels`. That is an area ratio. The model receives an image that is downscaled proportionally, so the visible-detail loss and coordinate precision loss follow the width/height scale ratio instead.

## Recall

Existing plan `specs/new-arch/2026-06-10-browser-mcp-screenshot-pixel-summary.md` introduced one shared helper, `screenshotPixelSummary`, and intentionally routed both screenshot and observe metadata through it. This remains the single source.

## Call Point Audit

Command:

`rg -n "screenshotPixelSummary|pixelSummary|SCREENSHOT_MODEL_PIXEL_BUDGET|SCREENSHOT_COMPRESSION_WARNING_RATIO|compressedPixels|compressionRatio|preferPartialScreenshot" packages/opencorvus/src packages/opencorvus/test specs -S -g '!**/dist/**' -g '!**/node_modules/**'`

| Call point | Decision |
| --- | --- |
| `packages/opencorvus/src/mcp/browser/tools.ts` `screenshotPixelSummary` | Change ratio semantics from area ratio to proportional width/height scale ratio. |
| `packages/opencorvus/src/mcp/browser/tools.ts` `okImage` | No separate logic; it keeps using `screenshotPixelSummary`. |
| `packages/opencorvus/src/mcp/browser/tools.ts` `observe` screenshot metadata | No separate logic; it keeps using `screenshotPixelSummary`. |
| `packages/opencorvus/test/mcp/browser-tools-resource.test.ts` | Update contract tests to assert linear ratio and compressed dimensions. |
| `packages/opencorvus/test/mcp/browser-stdio.test.ts` | Keep smoke assertions for unchanged small screenshots and add shape coverage for new fields where relevant. |
| `specs/new-arch/2026-06-10-browser-mcp-screenshot-pixel-summary.md` | Update the design note so historical plan no longer documents the wrong formula. |

## Design

Keep `currentPixels` and make `compressedPixels` match the actual proportional target dimensions. Add `compressedWidth` and `compressedHeight` so the structured summary exposes those dimensions directly.

For an image above budget:

- `dimensionScale = sqrt(modelPixelBudget / currentPixels)`
- `compressedWidth = floor(width * dimensionScale)`
- `compressedHeight = floor(height * dimensionScale)`
- `compressedPixels = compressedWidth * compressedHeight`
- `compressionRatio = max(width / compressedWidth, height / compressedHeight)`

For an image within budget, compressed dimensions equal the original dimensions and `compressionRatio = 1`.

## Verification

- `bun test packages/opencorvus/test/mcp/browser-tools-resource.test.ts`
- `bun test packages/opencorvus/test/mcp/browser-stdio.test.ts`
