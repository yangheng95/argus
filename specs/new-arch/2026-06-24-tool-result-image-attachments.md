# Tool Result Image Attachments - 2026-06-24

## Acronyms

- GUI: Graphical User Interface, the visible overlay message surface.
- MIME: Multipurpose Internet Mail Extensions, the content type string used to classify attachments.
- PNG: Portable Network Graphics, the image format used by browser preview evidence.
- URL: Uniform Resource Locator, the attachment location rendered by the overlay.

## Problem

`region comparison tool` already returns side-by-side and diff PNGs as
tool result attachments through `buildMultimodalToolResult`, and the screenshot
browser indexes `state.attachments`. The center tool-result card only renders
tool output text plus the special browser metadata screenshot path, so comparison
images are visible in the screenshot browser but not inline in the tool result
that produced them.

The missing owner is the generic overlay tool-result renderer, not the browser
preview compare backend.

## Recall

- `2026-06-18-preview-repair-tool-adapter-single-source.md` keeps
  `region comparison tool` as a `Tool.define` source used by stage
  agents through the shared adapter.
- `2026-06-17-browser-preview-region-runner-single-source.md` requires region
  comparison artifacts to come from task-scoped target/evidence runner state.
- `2026-06-17-browser-preview-latest-readable-evidence.md` keeps persisted
  browser preview evidence readable before the overlay projects it.
- `2026-06-22-browser-preview-evidence-previewable-image.md` made browser
  evidence screenshots use the shared image preview component.
- `2026-06-23-screenshot-thumbnail-load-queue-cancellation.md` records that
  the screenshot browser source is the card tree and existing tool attachment
  metadata.

## Grep Inventory

Commands:

```powershell
rg -n "region comparison tool|compareTaskTargetRegions|compare_regions|CompareRegions|compare regions" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S -g "*.ts" -g "*.tsx"
rg -n "type:\s*\"image\"|type:\s*\"file\"|mediaType.*image|attachments|data-image-preview|ToolOutput|tool-output|toolPart|tool-result|state\.output|output" packages/overlay/src/components packages/overlay/src/utils packages/overlay/src/store packages/overlay/test -S -g "*.ts" -g "*.tsx"
rg -n "attachments" packages/opencorvus/src/engine packages/opencorvus/src/session packages/opencorvus/src/agent packages/opencorvus/src/server -S -g "*.ts"
```

| Surface                                                           | Finding                                                                                    | Decision                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `packages/opencorvus/src/tool/region-comparison-tool.ts` | Builds `attachments` from side-by-side and diff artifacts via `buildMultimodalToolResult`. | Keep backend contract; no second image transport.                               |
| `packages/opencorvus/src/tool/multimodal-result.ts`               | Writes images into `AttachmentStore` and returns file attachment refs.                     | Reuse this as the source for UI display.                                        |
| `packages/opencorvus/src/session/loop.ts` / `processor.ts`        | Tool result attachments are stamped and persisted on `part.state.attachments`.             | Do not change event/session shape.                                              |
| `packages/overlay/src/utils/screenshot-browser.ts`                | Collects image refs from `state.attachments` or top-level `attachments`.                   | Mirror the same attachment locations for inline rendering.                      |
| `packages/overlay/src/components/FilePart.tsx`                    | Already renders image file parts through authenticated fetch and shared preview UI.        | Reuse `FilePart` for tool attachment images.                                    |
| `packages/overlay/src/components/InlineToolPart.tsx`              | Renders special `metadata.browser.screenshot`, but not generic tool attachment images.     | Add a generic image attachment block after structured output/browsing evidence. |
| `packages/overlay/test/browser/image-preview-copy.test.ts`        | Proves special browser metadata images can be opened and copied.                           | Extend the browser fixture with generic tool attachment images.                 |

## Fix

1. Add a small image-attachment extractor in `InlineToolPart` that reads
   `part.state.attachments` first and top-level `part.attachments` second.
2. Filter strictly to image attachments by MIME or explicit image URL shape.
3. Render those images with `FilePart`, preserving authenticated attachment
   loading and the shared image preview dialog.
4. Keep browser metadata screenshot rendering unchanged.
5. Add tests that the source wires generic tool attachment images through
   `FilePart`, and a real browser test that opens the comparison image from the
   tool result.

## Acceptance

- A completed tool part with image attachments renders the images inside the
  expanded tool result card.
- `region comparison tool` side-by-side/diff attachments need no
  backend-specific overlay branch.
- The screenshot browser still indexes the same attachment refs.
- Image preview opens from generic tool attachment images.
- Focused overlay unit/static tests and a real browser visual test pass.

## Verification

- PASS: `bun test packages/overlay/test/inline-tool-output-summary.test.ts packages/overlay/test/message-image-preview.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts --timeout 30000`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/image-preview-copy.test.ts`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `git diff --check`.
- Reviewed `.scratch/tool-result-image-attachments.png`: the expanded tool
  result card renders the compare-style image attachment inline below browser
  evidence metadata without overlap.
