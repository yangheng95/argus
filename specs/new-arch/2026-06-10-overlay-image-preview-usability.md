# Overlay Image Preview Usability

## Scope

User feedback: screenshot preview is too large, hard to close, and screenshots cannot be copied reliably.

## Call Point Audit

Command:

`rg -n 'image-preview-dialog|copyPreviewImage|calculateImagePreviewOpenScale|message image preview|image-preview-copy' packages/overlay/src packages/overlay/test`

| Call point                                                                        | Decision                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/components/ImagePreview.tsx` `copyPreviewImage`             | Keep the existing image preview component; make copy prefer the original image bytes through `fetch(src)` and fall back to canvas when fetch is unavailable or rejected. |
| `packages/overlay/src/styles/surfaces/messages.css` `.image-preview-dialog__form` | Replace near-fullscreen sizing with a bounded preview panel so backdrop click-to-close has usable space.                                                                 |
| `packages/overlay/src/utils/image-preview-scale.ts`                               | No behavior change; existing fit/open scale works once the body viewport is smaller.                                                                                     |
| `packages/overlay/test/message-image-preview.test.ts`                             | Update CSS contract and copy implementation assertions.                                                                                                                  |
| `packages/overlay/test/browser/image-preview-copy.test.ts`                        | Extend real browser test to prove copy pulls image bytes via the screenshot URL before writing PNG to clipboard.                                                         |

## Design

The preview remains a single shared dialog for markdown images, file images, and Browser MCP evidence screenshots. The dialog no longer fills the viewport by default; it uses a bounded width and height, preserving pan/zoom inside the body. Closing remains available through the header icon, Escape, and now a much larger backdrop area.

Copy uses `fetch(imagePreviewState().src)` first because Browser MCP screenshots are served as attachment URLs and should be copied as the original bytes. Canvas remains the fallback for already-loaded inline images.

## Verification

- `bun test test/message-image-preview.test.ts`
- `node --test test/browser/image-preview-copy.test.ts`
