# Message image preview

## Problem

Message images currently render as static `<img>` elements. Screenshots in the
message panel cannot be opened for inspection, and small images inherit the
message column width behavior instead of staying at their intrinsic display
size.

## Call Points

| Surface | Current source | Change |
| --- | --- | --- |
| File attachments | `packages/overlay/src/components/FilePart.tsx` | Replace raw attachment image markup with shared preview component. |
| Markdown images | `packages/overlay/src/utils/markdown.ts` | Emit preview metadata attributes from the markdown renderer. |
| Markdown clicks | `packages/overlay/src/main.tsx` | Delegate clicks on markdown image preview triggers to the shared preview service. |
| Image styles | `packages/overlay/src/styles/surfaces/markdown.css`, `packages/overlay/src/styles/surfaces/messages.css` | Keep thumbnails intrinsic-size capped and style the modal viewer. |

## Acceptance

- Attachment screenshots can be clicked to open a modal image preview.
- Markdown-rendered screenshots can be clicked through the same preview path.
- Preview controls support zoom in, zoom out, and reset.
- Message thumbnails use `width: auto` and `height: auto` with max constraints,
  so small images are not enlarged to the message column or viewport size.
- Tests lock the renderer attributes, attachment component usage, global click
  delegation, and CSS sizing contract.
