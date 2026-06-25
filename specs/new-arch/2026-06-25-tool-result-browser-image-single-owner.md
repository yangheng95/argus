# Tool Result Browser Image Single Owner - 2026-06-25

## Acronyms

- GUI: Graphical User Interface, the visible overlay message surface.
- MCP: Model Context Protocol, the protocol used by proxied browser tools.
- PNG: Portable Network Graphics, the screenshot image format returned by browser tools.
- URL: Uniform Resource Locator, the stored attachment path rendered by the overlay.

## Problem

`browser_screenshot` tool results can render one small and one large copy of the
same screenshot in the same expanded tool result card.

The browser MCP returns one image payload. OpenCorvus materializes it into one
AttachmentStore reference, then also records the same reference in
`metadata.browser.screenshot.attachmentUrl`. The overlay renders browser
metadata screenshots through the browser evidence block and renders generic
tool image attachments through the attachment block. When both fields reference
the same URL, one physical screenshot gets two UI owners.

## Recall

- `2026-06-24-tool-result-image-attachments.md` added generic tool result image
  attachment rendering for tools such as `browser_preview_compare_regions`.
- `2026-06-25-model-image-input-size-boundary.md` keeps tool-result image
  attachments as model-bound media and does not resize or replace images.
- `2026-06-23-screenshot-top-level-incremental-index.md` keeps the screenshot
  browser fed by card-tree screenshot items, including browser metadata and
  generic tool attachments.
- `2026-06-10-browser-mcp-screenshot-pixel-summary.md` and
  `2026-06-13-browser-screenshot-linear-compression-ratio.md` confirm the
  `browser_screenshot` text is only a pixel-pressure summary, not a second
  screenshot transport.

## Grep Inventory

Commands:

```powershell
rg -n "materializeMcpToolResult|attachmentUrl|state\\.attachments|toolImageAttachments|browserEvidenceItem|toolAttachmentItems" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test -S -g "*.ts" -g "*.tsx"
rg -n "msg-browser-evidence|msg-tool-attachments|tool-browser-evidence|tool-attachment" packages/overlay/src packages/overlay/test -S -g "*.ts" -g "*.tsx" -g "*.css"
```

| Surface | Finding | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/mcp/materialize.ts` | One MCP image becomes `attachments[0]`; browser metadata points `screenshot.attachmentUrl` at that same attachment. | Keep backend contract; it feeds model media and browser evidence metadata. |
| `packages/opencorvus/src/session/loop.ts` | MCP materialized attachments are stamped into tool result `state.attachments`. | Keep model-visible attachments intact. |
| `packages/overlay/src/components/InlineToolPart.tsx` | Browser evidence and generic tool attachments are both rendered for completed tool parts. | Make browser evidence own its exact screenshot URL in this card. |
| `packages/overlay/src/utils/screenshot-browser.ts` | The screenshot browser collects browser metadata and tool attachments as different sources, so same URL duplicates. | Skip generic tool attachment items whose URL is already owned by browser evidence for the same tool part. |
| `packages/overlay/test/browser/image-preview-copy.test.ts` | Browser fixture already renders browser evidence and a separate generic attachment. | Add a duplicate browser screenshot attachment and assert only the non-browser attachment remains generic. |
| `packages/overlay/test/screenshot-browser-panel.test.ts` | Collects browser evidence and generic attachment items. | Add a duplicate URL regression and keep the expected item list single-owner. |

## Fix

1. Extract the browser evidence screenshot URL from a completed tool part.
2. In inline tool result rendering, skip generic image attachments whose URL
   equals the browser evidence screenshot URL for that same part.
3. In screenshot browser item collection, use the browser evidence item source
   as the owner for that URL and skip matching generic tool attachments.
4. Do not remove other generic image attachments, because comparison/diff tools
   still rely on the generic attachment renderer.

## Acceptance

- A `browser_screenshot` part whose browser metadata and attachment point at
  the same stored image renders one inline screenshot, not two.
- Generic comparison/diff attachments with different URLs still render through
  `FilePart`.
- The screenshot browser does not list the same browser screenshot URL twice as
  both `tool-browser-evidence` and `tool-attachment`.
- Focused overlay tests and browser visual evidence pass.
