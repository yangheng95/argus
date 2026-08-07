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
  attachment rendering for tools such as `region comparison tool`.
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

| Surface                                                    | Finding                                                                                                             | Decision                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/mcp/materialize.ts`               | One MCP image becomes `attachments[0]`; browser metadata points `screenshot.attachmentUrl` at that same attachment. | Keep backend contract; it feeds model media and browser evidence metadata.                                |
| `packages/opencorvus/src/session/loop.ts`                  | MCP materialized attachments are stamped into tool result `state.attachments`.                                      | Keep model-visible attachments intact.                                                                    |
| `packages/overlay/src/components/InlineToolPart.tsx`       | Browser evidence and generic tool attachments are both rendered for completed tool parts.                           | Make browser evidence own its exact screenshot URL in this card.                                          |
| `packages/overlay/src/utils/screenshot-browser.ts`         | The screenshot browser collects browser metadata and tool attachments as different sources, so same URL duplicates. | Skip generic tool attachment items whose URL is already owned by browser evidence for the same tool part. |
| `packages/overlay/test/browser/image-preview-copy.test.ts` | Browser fixture already renders browser evidence and a separate generic attachment.                                 | Add a duplicate browser screenshot attachment and assert only the non-browser attachment remains generic. |
| `packages/overlay/test/screenshot-browser-panel.test.ts`   | Collects browser evidence and generic attachment items.                                                             | Add a duplicate URL regression and keep the expected item list single-owner.                              |

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

## Follow-up: Compare Attachment Layout

### Problem

`region comparison tool` can emit several side-by-side PNG evidence
attachments. After the single-owner fix, those images are no longer duplicated,
but the generic attachment surface still inherits ordinary message thumbnail
layout: the preview trigger is an inline-flex button and the image uses the
global Markdown thumbnail bounds. Multiple comparison screenshots with different
intrinsic sizes therefore read as a loose collage instead of one ordered
evidence list.

### Grep Inventory

Commands:

```powershell
rg -n "msg-tool-attachments|msg-img-wrap|msg-image-trigger|md-img" packages/overlay/src/styles packages/overlay/src/components packages/overlay/test -S
rg -n "region comparison tool|toolImageAttachments|FilePart|PreviewableImage" packages/overlay/src packages/overlay/test specs -S -g "*.tsx" -g "*.ts" -g "*.css" -g "*.md"
```

| Surface                                                    | Finding                                                                                                                 | Decision                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/InlineToolPart.tsx`       | All generic tool images render through one `<section class="msg-tool-attachments">` and `FilePart`.                     | Keep this single generic renderer; do not add a `region comparison tool` branch.                                       |
| `packages/overlay/src/components/FilePart.tsx`             | Image file parts use `PreviewableImage`, which emits the shared image preview button and `.md-img`.                     | Keep shared preview/copy behavior.                                                                                     |
| `packages/overlay/src/styles/surfaces/messages.css`        | `.msg-tool-attachments` is only a grid shell; image triggers stay inline-flex and images inherit global thumbnail caps. | Make the tool attachment section a single-column evidence stack with full-width rows and left-aligned preview buttons. |
| `packages/overlay/src/styles/surfaces/markdown.css`        | `.md-img` remains the global Markdown/message image thumbnail contract.                                                 | Do not change the global thumbnail rule; scope larger evidence bounds to `.msg-tool-attachments .md-img`.              |
| `packages/overlay/test/browser/image-preview-copy.test.ts` | Browser fixture has one generic attachment and one browser-owned duplicate.                                             | Expand it to multiple comparison attachments and assert no image is lost, duplicated, offset, or overlapped.           |

### Fix

1. Keep `FilePart` as the only generic tool image renderer.
2. Scope layout rules to `.msg-tool-attachments` so ordinary message images do
   not change.
3. Render tool attachments as a vertical evidence stack: full-width rows,
   left-aligned preview triggers, block images, and larger but bounded evidence
   thumbnails.
4. Add browser layout assertions for multiple comparison attachments.

### Acceptance

- Browser-owned screenshot URLs are still excluded from generic attachments.
- All non-browser comparison attachments remain visible in source order.
- Tool attachment rows share the same left edge and do not overlap.
- Image preview still opens and copies from generic tool attachment images.

## Superseded Follow-up: Attachment Right-Edge Position

### Recall

- The user supplied a 2790×1699 screenshot and clarified that the visible line
  is unrelated to the scrollbar or any dialog. The marked geometry is the
  position of a tool-result image inside its conversation card: the image is
  left-aligned while the remaining inline width exposes the card surface and
  border at the image's right edge.
- The image dimensions and aspect ratio are already correct. Stretching the
  bitmap, changing the card border, or changing the image-preview dialog would
  address the wrong owner.
- Whole-repository search reconfirmed that generic tool-result images have one
  layout owner: `.msg-tool-attachments .msg-img-wrap` in `messages.css`.
  `FilePart` and `PreviewableImage` own media/auth/preview behavior; user-message
  thumbnails use the separate `.chat-bubble__image-strip` contract.

### Decision

This direction was rejected after the user clarified that the red mark compared
the bottom Composer width with the conversation card width, not the Tool image
position. Generic Tool evidence images therefore retain the established
left-aligned ordered stack. The actual correction belongs to the shared
conversation/Composer edge contract.

### Verification Plan

1. Restore the original left-aligned Tool attachment contract.
2. Remove duplicate scrollbar-gutter compensation from the Composer's trailing
   inset so the input and card consume the same content edges.
3. Verify card/Composer parity with a non-zero gutter fixture and real browser
   screenshots.
