# 2026-06-19 Image Preview Trigger Accessible Name

ARIA means Accessible Rich Internet Applications. DOM means Document Object
Model.

## Problem

Image preview triggers use a fixed accessible name, `Open image preview`, even
when the thumbnail already has useful alt text. Because `aria-label` overrides
the nested image's `alt`, a screen reader or keyboard user navigating several
screenshots hears identical button names and cannot choose the intended image
before opening it.

## Recall

| Source                                           | Relevant constraint                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-08-message-image-preview.md`            | Markdown images and file/tool screenshots share one preview service.                                                          |
| `2026-06-09-image-preview-zoom-pan-fix.md`       | `PreviewableImage` is the shared thumbnail trigger for file and evidence images.                                              |
| `2026-06-10-tool-output-image-preview-copy.md`   | Tool output screenshots intentionally route through `PreviewableImage`; fixes belong in the shared preview path.              |
| `2026-06-18-image-preview-copy-single-source.md` | Image preview identity should come from `imagePreviewState().src` and the shared preview entry point, not per-surface copies. |

## Impact Sweep

| Sweep                                                 | Result                                                                  | Decision                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------- | ------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `rg -n "Open image preview                            | data-image-preview-trigger                                              | data-image-preview-alt                                                  | PreviewableImage | ImagePreview | image preview" packages/overlay/src packages/overlay/test specs/new-arch specs` | Fixed labels live in `ImagePreview.tsx` and `markdown.ts`; delegated open logic in `main.tsx` already reads `data-image-preview-alt`. | Replace both fixed labels through one helper. |
| `FilePart.tsx`                                        | Uses `PreviewableImage` with file name or explicit alt.                 | Keep call sites unchanged; fix the shared component.                    |
| `InlineToolPart.tsx` and `ScreenshotBrowserPanel.tsx` | Tool/browser evidence screenshots use `PreviewableImage`.               | Keep call sites unchanged; fix the shared component.                    |
| `message-image-preview.test.ts`                       | Existing tests only check metadata and shared component reuse.          | Add accessible-name assertions for Markdown and component source.       |
| `messages.css`                                        | `.msg-image-trigger:focus-visible` already owns the visible focus ring. | Add browser evidence that focus remains visible after the label change. |

## Fix Plan

1. Add a shared `imagePreviewTriggerLabel(alt)` helper.
2. Use it in `PreviewableImage`.
3. Use it in Markdown image rendering before escaping the generated label.
4. Extend unit tests so Markdown labels include alt text and source no longer
   hard-codes the fixed label.
5. Add a browser test with two thumbnails: names must differ and the focused
   trigger must keep a visible outline.

## Acceptance

- No production source emits `aria-label="Open image preview"` as a fixed image
  trigger name.
- Markdown and Solid preview triggers derive the accessible name from the same
  helper.
- Trigger names include the thumbnail alt when present and retain the base label
  when alt is empty.
- Browser screenshot confirms the focused thumbnail trigger remains visually
  outlined.
