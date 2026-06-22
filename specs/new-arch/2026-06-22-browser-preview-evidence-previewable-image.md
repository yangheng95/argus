# Browser Preview Evidence Previewable Image

Date: 2026-06-22
Status: Implemented

## Acronyms

- UI: User Interface, the overlay controls and rendered panels.
- PNG: Portable Network Graphics, the persisted browser preview screenshot format.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Repair the browser preview evidence screenshot rendering so it reuses the shared
`PreviewableImage` trigger path instead of owning a direct evidence-only `<img>`
contract.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No dual sources, no local UI primitive fork, test every change, and visually verify UI changes. |
| `2026-06-20-image-preview-trigger-contract-single-source.md` | `PreviewableImage` and markdown share one trigger contract and delegated image preview host. |
| `2026-06-20-image-preview-trigger-i18n-button.md` | Solid image thumbnails should use the shared `Button` primitive through `PreviewableImage`. |
| `2026-06-11-browser-preview-evidence-image-display.md` | Browser preview evidence remains PNG-backed and must not reintroduce iframe rendering. |
| `2026-06-17-browser-preview-evidence-test-open-path.md` | Browser preview evidence browser tests must use the real open path and screenshot the evidence surface. |

## Call Point Inventory

| Surface | Current evidence | Decision |
| --- | --- | --- |
| Evidence image | `BrowserPreviewPanel.tsx` renders `<img data-ui="browser-preview-screenshot">` inside `.browser-preview-evidence-shot`. | Replace direct evidence image markup with `PreviewableImage`. |
| Shared preview | `ImagePreview.tsx` only allows trigger/image classes. | Add narrow image metadata props so browser preview can preserve `data-ui` and evidence ID without overriding src/alt. |
| Delegated host | `main.tsx` opens previews through `[data-image-preview-trigger]`. | Preserve this single delegated path. |
| Live preview | `browser-preview-live-screenshot` is interactive page input, not a passive evidence thumbnail. | Leave live image direct because it handles click/wheel/key input and should not open the image preview host. |
| CSS owner | `inspector.css` owns `.browser-preview-evidence-shot`. | Retarget evidence shot styles to the `PreviewableImage` button host and override `md-img` sizing locally. |
| Tests | Static panel test and browser evidence/visual-stress tests query `data-ui="browser-preview-screenshot"`. | Keep that data attribute on the image element and update static tests to require `PreviewableImage`. |

## Root Cause

Browser preview evidence has a parallel image-thumbnail implementation: it
manually renders an image, owns its sizing rules, and does not participate in
the shared preview trigger contract. That creates a component reuse gap beside
message images and screenshot-browser thumbnails, which already use
`PreviewableImage`.

## Fix Plan

1. Extend `PreviewableImage` with optional image-layer attributes that cannot
   replace the core trigger contract.
2. Render browser preview evidence screenshots with `PreviewableImage`, keeping
   existing evidence metadata on the image element.
3. Update `.browser-preview-evidence-shot` CSS to style the `Button` host and
   reset shared markdown image defaults inside that host.
4. Add static tests that forbid evidence-only direct screenshot images and
   require `PreviewableImage`.
5. Run focused static tests, typecheck, and the real browser preview evidence
   test with screenshots reviewed.

## Acceptance

- Browser preview evidence screenshots use `PreviewableImage`.
- `data-ui="browser-preview-screenshot"` and `data-evidence-id` stay available
  for existing browser tests and diagnostics.
- Live preview screenshots remain direct interactive images.
- No iframe, alternate preview host, direct fetch, or local image storage path is
  introduced.
- Focused tests, typecheck, and browser evidence visual verification pass.

## Implementation Notes

- `PreviewableImage` now accepts narrow image-layer attributes so callers can
  keep diagnostic `data-*` metadata without owning a separate trigger.
- `BrowserPreviewPanel` renders persisted evidence screenshots through
  `PreviewableImage`; live preview screenshots remain direct interactive images.
- `.browser-preview-evidence-shot` now styles the shared `Button` host and
  locally resets `.md-img` defaults for the evidence image.

## Verification

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/message-image-preview.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-evidence.test.ts`
- Visual evidence reviewed:
  `.scratch/browser-preview-evidence-previewable-image.png`.
- Additional non-required stress check
  `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-visual-stress.test.ts`
  produced no output for about 150 seconds and was terminated; it is not counted
  as passed.
