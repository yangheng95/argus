# 2026-06-19 Image Preview Dialog i18n Source

ARIA means Accessible Rich Internet Applications. DOM means Document Object
Model. i18n means internationalization.

## Problem

`ImagePreviewHost` still owns English literals for its dialog title, toolbar
labels, copy button, and copy status messages. Chinese users opening any shared
message or tool screenshot preview still see or hear English strings even though
the overlay locale system is active.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | User-visible strings must follow the project i18n system; UI fixes require tests and browser evidence. |
| `2026-06-19-image-preview-trigger-accessible-name.md` | Image preview is a shared entry point for markdown, file, and tool evidence thumbnails. Fixes belong in the shared preview path. |
| `2026-06-18-image-preview-shadow-token-source.md` | Image preview dialog is already covered by browser visual evidence, so dialog changes must preserve real rendered validation. |
| `packages/overlay/src/utils/i18n.ts` | Solid components should call strict `t()` at render time after both locale bundles are loaded. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n 'Zoom in|Zoom out|Fit width|Fit image|Fit whole image|Original size|Copy image|Current zoom|Image preview controls|Image preview|Copied|Copy failed...' packages/overlay/src/components/ImagePreview.tsx packages/overlay/test/... packages/overlay/src/i18n` | Production English literals are isolated to `ImagePreview.tsx`; tests in `message-image-preview.test.ts` and `browser/image-preview-copy.test.ts` lock them in. | Replace literals in `ImagePreviewHost` and update tests that asserted the old English source. |
| `rg -n 'useI18n|createI18n|\bt\(|locale|oc_locale|__OPENCORVUS_LOCALE__' packages/overlay/src` | The overlay already uses `t()` from `utils/i18n.ts`; browser fixtures set locale through `__OPENCORVUS_LOCALE__`, Tauri settings, and `localStorage`. | Import `t()` directly; no new i18n mechanism. |
| `git diff -- packages/overlay/src/i18n/en-US.json packages/overlay/src/i18n/zh-CN.json` | Existing uncommitted mission download translations are present. | Preserve those lines and add only `image_preview.*` keys. |
| `rg -n 'image_preview\.' packages/overlay/src/i18n` | No existing image preview namespace exists. | Add one flat namespace in both supported locale files. |

## Fix Plan

1. Replace `ImageCopyError.message` and `CopyFeedback.message` with
   `image_preview.*` i18n keys so copy status renders from the active locale.
2. Render dialog title, toolbar labels, title attributes, visible `Width` and
   `Fit` button text, copy button, copy status, and close label through `t()`.
3. Add matching `image_preview.*` keys to `en-US.json` and `zh-CN.json`.
4. Extend static tests so both locale bundles contain the full image preview
   key set and `ImagePreview.tsx` no longer contains the retired English
   toolbar/status literals.
5. Run the browser image preview copy test in `zh-CN`, assert Chinese
   accessible names and status messages, and save a screenshot of the dialog.

## Acceptance

- `ImagePreview.tsx` contains no hard-coded English image preview dialog labels
  or copy status messages.
- `en-US` and `zh-CN` both contain the same `image_preview.*` keys.
- Browser evidence opens the real image preview dialog in `zh-CN`, confirms
  toolbar accessible names and copy status messages are Chinese, and captures a
  screenshot showing the localized dialog controls without overflow.
