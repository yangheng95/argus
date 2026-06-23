# Image Preview Trigger Contract Single Source

Date: 2026-06-20

DOM means Document Object Model.

## Recall

| Source                                            | Relevant constraint                                                                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                       | Avoid double sources and do not hand-roll component primitive contracts when a shared primitive/helper can own the contract.                                 |
| `2026-06-20-image-preview-trigger-i18n-button.md` | `PreviewableImage` already moved to the shared `Button` primitive and markdown still needs the same trigger contract because it renders through `innerHTML`. |
| `ImagePreview.tsx`                                | Solid image thumbnails use `Button`, `imagePreviewTriggerLabel`, and the `data-image-preview-trigger` delegated open path.                                   |
| `markdown.ts`                                     | Markdown images still hand-build the full button class, data attributes, title, and aria-label string.                                                       |
| `image-preview-accessible-name.test.ts`           | The browser test uses `page.setContent()` and copies two full trigger buttons, so it verifies fixture markup rather than the mounted overlay path.           |

## Evidence Sweep

| Search                          | Result                                                                                 | Decision                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `rg "msg-image-trigger          | PreviewableImage                                                                       | data-image-preview                                                                                     | ImagePreviewHost" packages/overlay/src packages/overlay/test specs/new-arch` | Live trigger paths are `PreviewableImage` and markdown image HTML; delegated open stays in `main.tsx`; `App` owns one `ImagePreviewHost`. | Keep one host and one delegated open path. |
| `message-image-preview.test.ts` | Static tests still assert markdown's hand-written data contract directly.              | Update tests to assert markdown consumes the shared helper.                                            |
| `image-preview-copy.test.ts`    | Existing full overlay fixture proves a mounted conversation can open the preview host. | Rework accessible-name browser coverage onto a mounted conversation fixture instead of `setContent()`. |

## Fix

- Add `utils/image-preview-trigger.ts` as the single source for trigger class, Button variant/size/tone, data attributes, labels, and markdown HTML attribute serialization.
- Use that helper in `PreviewableImage`.
- Use that helper in markdown image rendering; markdown can still output HTML strings, but cannot hand-write the trigger contract.
- Update static tests to guard the helper adoption and prevent `markdown.ts` from owning private trigger attributes.
- Replace the browser accessible-name fixture with a real overlay conversation containing markdown images, then click one trigger and assert the shared `ImagePreviewHost` opens.

## Acceptance

- `markdown.ts` contains no hand-written `data-variant`, `data-size`, `data-tone`, `data-ui`, or `data-image-preview-*` trigger attribute strings.
- `PreviewableImage` and markdown both consume `imagePreviewTriggerContract`.
- Real browser coverage renders markdown through `TextPart`/conversation, verifies localized accessible names and focus, clicks the trigger, and captures the opened preview dialog.
- Static `message-image-preview.test.ts` and real browser coverage pass.
