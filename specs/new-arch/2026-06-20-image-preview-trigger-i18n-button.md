# Image Preview Trigger i18n Button

## Problem

Image preview thumbnail triggers have two active debts:

1. `packages/overlay/src/utils/image-preview-label.ts` hard-codes
   `Open image preview`, so `zh-CN` still exposes English `title` and
   `aria-label` on both Solid `PreviewableImage` thumbnails and Markdown image
   thumbnails.
2. `PreviewableImage` renders a raw `<button class="msg-image-trigger">`, while
   Markdown emits a hand-built raw button with the same private class. That
   duplicates the button/focus chrome outside the shared `Button` primitive.

The root issue is the shared image-trigger helper and contract, not one caller.

## Recall

| Search | Result |
| --- | --- |
| `rg "Open image preview|imagePreviewTriggerLabel|data-image-preview-trigger|PreviewableImage|msg-image-trigger" packages/overlay/src packages/overlay/test specs/new-arch` | Live label callers are `ImagePreview.tsx` and `markdown.ts`; delegated click handling reads only `data-image-preview-trigger/src/alt`; tests pin the English helper output and private class. |
| `2026-06-19-image-preview-trigger-accessible-name.md` | Previous fix intentionally centralized names through `imagePreviewTriggerLabel`, but did not put the helper behind i18n. |
| `2026-06-19-markdown-code-copy-button-primitive.md` | Markdown raw HTML can still follow the shared button primitive contract by emitting `.oc-button` plus `data-variant`, `data-size`, `data-tone`, and `data-ui`. |
| `packages/overlay/src/components/ui/Button.tsx` | Solid callers should use `Button`, which owns `.oc-button` and primitive data attributes. |

## Fix Plan

1. Add `image_preview.open_trigger` and
   `image_preview.open_trigger_with_alt` to both locale catalogs.
2. Make `imagePreviewTriggerLabel(alt)` call `t()` and select one of those
   keys. Keep all caller logic unchanged so Solid and Markdown share one label
   source.
3. Render `PreviewableImage` with `Button` using `variant="ghost"`, `size="md"`,
   `tone="neutral"`, and `data-ui="image-preview-trigger"`.
4. Make Markdown image HTML emit the same `.oc-button` data contract because it
   cannot instantiate the Solid component inside `innerHTML`.
5. Retarget `.msg-image-trigger` CSS so it only sets thumbnail layout variables
   on `.oc-button[data-ui="image-preview-trigger"]`; delete private focus
   outline duplication and rely on `.oc-button:focus-visible`.
6. Update static and browser tests for localized trigger labels, primitive
   button contract, and focus screenshots.

## Acceptance

- `imagePreviewTriggerLabel` contains no hard-coded English UI copy.
- `zh-CN` Markdown image triggers produce Chinese `title` and `aria-label`.
- Solid `PreviewableImage` uses `Button`; Markdown emits the same `.oc-button`
  contract.
- No private `.msg-image-trigger:focus-visible` rule remains.
- Browser test confirms localized names and visible focus in a real rendered
  thumbnail fixture.
