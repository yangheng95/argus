# Image Preview Zoom And Pan Fix

Date: 2026-06-09
Status: Implementation plan

## Acronyms

- UI: User Interface, the visible image viewer and controls.
- DOM: Document Object Model, the rendered browser element tree.
- URL: Uniform Resource Locator, the image source used by markdown, file parts, and evidence cards.

## Problem

The shared image preview opens at `100%` and scales the bitmap with CSS `transform`. The scroll container still measures the unscaled image, so the visible bitmap and scrollable layout disagree. Tall screenshots open cropped, the long filename wraps over the toolbar, and zooming does not give predictable pan or fit behavior.

## Codebase Evidence

| Area | Evidence | Decision |
| --- | --- | --- |
| Shared host | `packages/overlay/src/components/ImagePreview.tsx` owns `ImagePreviewHost`, zoom state, toolbar buttons, and rendered image markup. | Replace transform-only zoom with layout-sized zoom, default fit-to-window, pointer pan, and wheel zoom anchored to the cursor. |
| Preview state | `packages/overlay/src/services/image-preview.ts` owns only `{ open, src, alt }`. | Keep this as the single source for open image identity; viewer interaction state stays local to the host. |
| Callers | `main.tsx`, `utils/markdown.ts`, `FilePart.tsx`, and `InlineToolPart.tsx` all route images into the shared host. | Keep callers unchanged so markdown, file parts, and browser evidence use one viewer. |
| Styles | `packages/overlay/src/styles/surfaces/messages.css` owns `.image-preview-dialog__*`. | Make the dialog a bounded viewer surface, truncate the title, and size the stage by the scaled bitmap dimensions instead of a transform. |
| Regression tests | `packages/overlay/test/message-image-preview.test.ts` asserts shared routing and modal zoom CSS. | Update tests for fit scale helper, no transform zoom, scaled layout dimensions, pan handlers, and fit/original controls. |

## Call Point Sweep

| Symbol / Selector | Call points | Action |
| --- | --- | --- |
| `openImagePreview` | `main.tsx`, `ImagePreview.tsx`, `image-preview.ts` | Keep API unchanged. |
| `closeImagePreview` | `ImagePreview.tsx`, `image-preview.ts` | Keep API unchanged. |
| `imagePreviewState` | `ImagePreview.tsx`, `image-preview.ts` | Keep image identity source unchanged. |
| `PreviewableImage` | `FilePart.tsx`, `InlineToolPart.tsx`, `message-image-preview.test.ts` | Keep shared thumbnail trigger unchanged. |
| `data-image-preview-trigger` | `utils/markdown.ts`, `main.tsx`, `ImagePreview.tsx`, tests | Keep delegated markdown trigger unchanged. |
| `.image-preview-dialog__body` | `messages.css`, `ImagePreview.tsx`, tests | Convert to a scrollable pan surface. |
| `.image-preview-dialog__image` | `messages.css`, `ImagePreview.tsx`, tests | Remove transform scaling; use scaled width and height variables. |

## Implementation

1. Add a pure fit-scale helper that computes the default scale from natural image size and viewer viewport.
2. Measure the loaded image and viewer body, then open at fit-to-window instead of unconditional `100%`.
3. Change zoom to update real layout dimensions, preserving the scroll anchor while zooming.
4. Add fit and original-size toolbar actions, plus pointer drag panning on the scroll surface.
5. Update CSS so the header title truncates, the toolbar stays reachable, and the body is a fixed-height scrollable viewer.

## Acceptance

- A tall screenshot opens with the full image visible when its fit scale is within the configured lower bound.
- `100%` no longer means the default open state; it is an explicit original-size action.
- Zoom uses width and height layout dimensions, not `transform: scale(...)`.
- Scrollbars and pointer panning operate on the scaled bitmap dimensions.
- Existing markdown/file/evidence preview routes still use the shared host.
