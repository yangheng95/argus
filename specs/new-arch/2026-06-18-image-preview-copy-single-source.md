# Image Preview Copy Single Source

Date: 2026-06-18
Status: Implementation plan

## Acronyms

- UI: User Interface, the visible overlay dialog and toolbar.
- PNG: Portable Network Graphics, the image format supported by the current copy action.
- DOM: Document Object Model, the rendered browser element tree.
- API: Application Programming Interface, the browser clipboard surface.

## Problem

`ImagePreviewHost.copyPreviewImage` fetches the preview source and silently falls back to canvas re-encoding when fetch fails or returns a non-PNG blob. That creates two copy sources for the same visible action, hides source failures behind a successful canvas path, and only logs failures to the console when clipboard write fails.

The 2026-06-10 usability plan explicitly allowed this fallback. Current project constraints forbid fallback and dual-source behavior, so this slice replaces the copy action with a single canonical byte source: `imagePreviewState().src` fetched as PNG bytes.

## Call Point Sweep

Command:

`rg "ImagePreview|image preview|copy image|clipboard|canvasPreviewImageBlob|copyPreviewImage" specs packages/overlay/src packages/overlay/test -n`

| Surface | Call points | Decision |
| --- | --- | --- |
| `PreviewableImage` | `packages/overlay/src/components/FilePart.tsx`, `packages/overlay/src/components/InlineToolPart.tsx`, markdown delegated click in `packages/overlay/src/main.tsx` | Keep the shared preview entry point unchanged. |
| `ImagePreviewHost` | `packages/overlay/src/components/App.tsx`, `packages/overlay/src/components/ImagePreview.tsx` | Replace copy internals only; keep one host and one dialog. |
| `imagePreviewState().src` | `packages/overlay/src/services/image-preview.ts`, `ImagePreviewHost` | Use as the single copy byte source. |
| Protected resource object URLs | `packages/overlay/src/components/FilePart.tsx`, `packages/overlay/src/components/InlineToolPart.tsx`, `packages/overlay/src/components/ScreenshotBrowserPanel.tsx` | Keep the existing `fetchResourceAsObjectUrl` resource path; copy fetches the preview `blob:` URL because that is the current visible preview source. |
| `canvasPreviewImageBlob` | `packages/overlay/src/components/ImagePreview.tsx`, static assertion in `packages/overlay/test/message-image-preview.test.ts` | Delete the canvas copy path and assert it stays deleted. |
| Browser copy test | `packages/overlay/test/browser/image-preview-copy.test.ts` | Keep success coverage and add visible failure coverage for fetch failure, clipboard rejection, and missing clipboard API. |
| Toolbar CSS | `packages/overlay/src/styles/surfaces/messages.css` | Add a compact status/alert pill inside the existing toolbar. |

## Acceptance

- Copy fetches `imagePreviewState().src` and writes exactly one `ClipboardItem` when the source is a PNG.
- Protected attachments copied from the preview use the current `blob:` preview source, not a second fetch against the original attachment URL.
- Fetch failure, non-PNG source, blocked clipboard write, or missing clipboard API produces visible toolbar feedback, not a console-only failure.
- There is no canvas copy fallback or canvas re-encode path in `ImagePreviewHost`.
- Static and browser tests prevent the old two-source behavior from returning.

## Verification

- `bun test packages/overlay/test/message-image-preview.test.ts`
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-timeout=60000 packages/overlay/test/browser/image-preview-copy.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Real browser screenshot of the ImagePreview copy failure state.
