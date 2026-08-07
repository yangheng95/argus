# 2026-06-29 Model Image Input Auto Resize

## Acronyms

- LLM: Large Language Model, the provider-hosted model process that receives text, tool results, and media inputs.
- MCP: Model Context Protocol, the tool protocol used by browser and other tool servers.
- MIME: Multipurpose Internet Mail Extensions, the content type string used to classify attachments.
- PNG: Portable Network Graphics, the screenshot image format used by browser and visual evidence tools.
- JPEG: Joint Photographic Experts Group, a compressed photographic image format.
- WebP: Web Picture format, a browser image format used for compressed images.

## Recall

- User requirement: change image handling to automatically compress image dimensions because image size exploded and still caused model context overflow.
- Acceptance criteria:
  - Model-bound PNG, JPEG, and WebP image bytes are automatically resized before provider delivery when dimensions or pixel area exceed the shared model image budget.
  - Original persisted screenshot/evidence attachments remain unchanged.
  - The resize path is shared by user file parts, tool-result image attachments, direct provider transform local refs, and MCP screenshot pixel summaries.
  - Existing blank-margin crop still runs before resize.
  - Tests prove oversized images are resized instead of rejected on normal model-bound paths.
- Hard constraints:
  - No parallel image budget source.
  - No screenshot capture rewrite in this change.
  - No hidden dropped image, synthetic message split, or compatibility branch.
  - No git reset or worktree creation.
- Disk records read:
  - `specs/records/2026-06/2026-06-25-model-image-input-size-boundary.md`
  - `specs/records/2026-06/2026-06-26-model-image-input-blank-crop.md`
  - `specs/records/2026-06/2026-06-13-browser-screenshot-linear-compression-ratio.md`
- Grep commands run:
  - `rg -n "url_screenshot|captureBrowserMcpViewportScreenshot|fullPage|screenshot\(|okImage|pngDimensionsStrict|clip|selector|prepareModelImageInput|SCREENSHOT_MODEL_PIXEL_BUDGET|compressedWidth|compressionRatio" packages/opencorvus/src packages/opencorvus/test specs/records/2026-06 -S`
  - `rg -n "ModelImageInputTooLargeError|prepareModelImageInput|assertModelImageInputWithinLimits|MAX_MODEL_IMAGE_INPUT_DIMENSION|SCREENSHOT_MODEL_PIXEL_BUDGET|screenshotPixelSummary|rejects oversized|oversized.*image|blank-cropped image exceeds" packages/opencorvus/src packages/opencorvus/test specs/records/2026-06 -S -g '!**/dist/**' -g '!**/node_modules/**'`
  - `rg -n "image.*token|token.*image|pixel.*budget|SCREENSHOT_MODEL_PIXEL_BUDGET|context.*image|ModelImageInputTooLargeError|MAX_MODEL_IMAGE_INPUT_DIMENSION|maxDimension|compressedPixels|compressedWidth|image-data|mimeType.*image" packages/opencorvus/src packages/opencorvus/test specs/records/2026-06 -S -g '!**/node_modules/**' -g '!**/dist/**'`
- Independent agent feedback: no subagent was spawned because the available subagent tool explicitly allows spawning only when the user asks for subagents, delegation, or parallel agent work.

## Problem

The existing implementation did not resize images. It only:

1. cropped blank margins at the model-input boundary;
2. enforced an 8000-pixel max single dimension after cropping;
3. reported MCP screenshot compression metadata without changing image bytes.

For full-page captures such as `1440x19773`, blank-margin crop does not reduce real page content. The model-bound image therefore remains too large or fails locally. Images with both dimensions below 8000 can still consume excessive image tokens when total pixel area is large.

## Design

Replace the model-bound oversized-image failure semantics with deterministic proportional resize at the same single boundary that already owns crop and model delivery.

Shared constants:

- `MAX_MODEL_IMAGE_INPUT_DIMENSION = 8000`
- `MODEL_IMAGE_INPUT_PIXEL_BUDGET = 1_048_576`
- `MODEL_IMAGE_INPUT_COMPRESSION_WARNING_RATIO = 2`

Resize scale:

```text
scale = min(
  1,
  maxDimension / width,
  maxDimension / height,
  sqrt(maxPixels / (width * height))
)
```

The target dimensions start as `round(width * scale)` and `round(height * scale)`, with a minimum of 1 pixel. They are then reduced only when needed to satisfy the single-dimension and total-pixel budgets. Rounding avoids over-compressing narrow tall screenshots where flooring the short edge would force the renderer to shrink the long edge more than the budget requires.

## Callpoint Inventory

| Area | File | Decision |
| --- | --- | --- |
| Shared budget and summary | `packages/opencorvus/src/session/model-image-input.ts` | Export the model image budget and pixel summary from the model-input owner. |
| Browser MCP screenshot summary | `packages/opencorvus/src/mcp/browser/tools.ts` | Import the shared summary instead of owning a second screenshot pixel budget. |
| Session replay/user files/tool results | `packages/opencorvus/src/session/message.ts` | Existing calls to `prepareModelImageInput()` now receive resized bytes. |
| Provider transform direct local refs | `packages/opencorvus/src/provider/transform.ts` | Existing calls to `prepareModelImageInput()` now receive resized bytes. |
| URL screenshot capture | `packages/opencorvus/src/frontend-design/url-screenshot-tool.ts` and `capture-gate.ts` | Keep original capture and evidence unchanged; resize only during model delivery. |
| Tests | `packages/opencorvus/test/session/model-image-input.test.ts`, `packages/opencorvus/test/session/message.test.ts`, `packages/opencorvus/test/provider/transform.test.ts`, `packages/opencorvus/test/mcp/browser-tools-resource.test.ts` | Update rejection expectations to resized model-bound bytes and shared summary source. |

## Acceptance

- `prepareModelImageInput()` crops blank margins before resize.
- `prepareModelImageInput()` resizes oversized PNG, JPEG, and WebP inputs to fit both max dimension and pixel budget.
- Stored user image refs and tool-result data URL images replay as model parts instead of throwing for oversize.
- Browser MCP screenshot pixel summary uses the same budget as the actual model-input resize path.
- The durable attachment store and screenshot artifact files are not modified by resize.
