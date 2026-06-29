# Tool Output Image Preview Copy

Date: 2026-06-10
Status: Implementation plan

## Acronyms

- UI: User Interface, the visible image preview dialog and toolbar.
- DOM: Document Object Model, the browser element tree backing the preview.
- PNG: Portable Network Graphics, the clipboard image format written by the preview.
- API: Application Programming Interface, the browser clipboard surface used by the overlay.

## Problem

Tool output screenshots render through the shared message image preview, but the preview dialog has no image clipboard action. Text copy exists on cards and markdown code, while images can only be opened and inspected. Because browser evidence and file attachments already route through `PreviewableImage`, the fix belongs in the shared `ImagePreviewHost`, not in each tool output renderer.

## Call Point Sweep

| Symbol / Surface                 | Call points                                                                                          | Action                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `PreviewableImage`               | `packages/overlay/src/components/FilePart.tsx`, `packages/overlay/src/components/InlineToolPart.tsx` | Keep existing shared entry point.                      |
| `ImagePreviewHost`               | `packages/overlay/src/components/ImagePreview.tsx`, mounted from `packages/overlay/src/main.tsx`     | Add the copy image toolbar action.                     |
| `imagePreviewState`              | `packages/overlay/src/services/image-preview.ts`, consumed by `ImagePreviewHost`                     | Keep image identity source unchanged.                  |
| `navigator.clipboard.write`      | New usage in `ImagePreviewHost`                                                                      | Write current preview bitmap as `image/png`.           |
| `.image-preview-dialog__toolbar` | `packages/overlay/src/styles/surfaces/messages.css`                                                  | Reuse existing toolbar layout.                         |
| `message-image-preview.test.ts`  | Existing image preview regression test                                                               | Add assertions for copy action and PNG clipboard path. |

## Acceptance

- Tool output screenshots opened in the shared preview expose a copy-image toolbar button.
- The copy action writes image bytes, not the image URL text.
- Clipboard output uses `image/png` from the loaded preview bitmap.
- Existing markdown, file attachment, and browser evidence preview routing remains unchanged.
