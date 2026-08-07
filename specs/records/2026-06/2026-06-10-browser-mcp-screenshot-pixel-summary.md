# Browser MCP Screenshot Pixel Summary

## Scope

User request: Browser MCP screenshot results must describe the current pixel count, compressed pixel count, and warn when compression is too large so agents prefer partial screenshots.

## Call Point Audit

Command:

`rg -n "screenshot size|registerTool\\(\\s*\"screenshot\"|includeScreenshot|structuredContent\\.screenshot|browserObservationMetadata|okImage" packages/opencorvus/src packages/opencorvus/test specs`

| Call point                                                                | Decision                                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mcp/browser/tools.ts` `okImage`                  | Replace the old `screenshot size: WxH` text with a shared pixel summary.                                                                            |
| `packages/opencorvus/src/mcp/browser/tools.ts` `screenshot`               | Keep capture behavior unchanged; return pixel summary in structured content.                                                                        |
| `packages/opencorvus/src/mcp/browser/tools.ts` `observe`                  | Use the same pixel summary for embedded screenshot metadata so `observe` does not become a second screenshot contract.                              |
| `packages/opencorvus/src/mcp/materialize.ts` `browserObservationMetadata` | No behavioral change required; it already forwards screenshot width and height into metadata.                                                       |
| `packages/opencorvus/test/mcp/browser-stdio.test.ts`                      | Extend existing screenshot assertions to verify result text and structured summary.                                                                 |
| `packages/opencorvus/test/mcp/browser-tools-resource.test.ts`             | Add a source-level contract test for the compression warning text so the local-screenshot guidance cannot regress without the heavier browser test. |

## Design

Add one helper in `mcp/browser/tools.ts` that computes:

- `currentPixels = width * height`
- `dimensionScale = sqrt(modelPixelBudget / currentPixels)` when the screenshot exceeds budget, otherwise `1`
- `compressedWidth = floor(width * dimensionScale)`
- `compressedHeight = floor(height * dimensionScale)`
- `compressedPixels = compressedWidth * compressedHeight`
- `compressionRatio = max(width / compressedWidth, height / compressedHeight)`
- `preferPartialScreenshot = compressionRatio >= warningRatio`

The helper only describes expected model-side proportional visual downscaling pressure. It does not add routing gates, block full-page screenshots, or introduce a second capture path. When the ratio is high, the text says: `压缩率过大，请优先使用 selector 或 clip 做局部截图。`

## Verification

- `bun test test/mcp/browser-tools-resource.test.ts`
- `bun test test/mcp/browser-stdio.test.ts`
