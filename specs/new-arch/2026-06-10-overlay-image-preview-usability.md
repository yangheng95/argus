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

## Follow-up 2026-06-23: Container Query Size Contract

### Recall

| Source                                            | Constraint carried forward                                                                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Overlay UI must stay inside the legal layout frame and token-owned panel minimums; illegal viewport aspect ratios are not an alternate layout source. |
| `2026-06-23-overlay-compact-legal-frame-query.md` | Descendant surfaces use container query units so they follow the legal overlay container instead of the raw browser viewport.                         |
| This spec                                         | The image preview dialog stays bounded, leaves usable close/backdrop space, and keeps toolbar copy status readable.                                   |

### Call Point Inventory

| Surface          | Evidence                                                                                                                                                        | Decision                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dialog form CSS  | `.dialog .image-preview-dialog__form` in `messages.css` uses `100cqw`, while `message-image-preview.test.ts` still asserted the old `100vw` width.              | Treat the CSS as the source and update the test to reject viewport-width sizing.                                                                        |
| Copy status CSS  | `.image-preview-dialog__copy-status` uses `52cqw`, while the static test still asserted `52vw`.                                                                 | Update the test and keep the toolbar status bounded by the legal container.                                                                             |
| Browser coverage | `image-preview-accessible-name.test.ts` captures the mounted preview dialog, and `image-preview-copy.test.ts` captures the localized toolbar/copy-status state. | Assert dialog close space against `document.body`'s `overlay-shell` container, then re-run both through the Node browser runner and review screenshots. |

### Root Cause

The runtime CSS had already moved image preview sizing to container query units,
but the static test retained the old viewport-width literals. That made the
test a stale second source for illegal raw-viewport sizing and allowed future
changes to drift away from the overlay legal frame contract.

### Fix Plan

1. Update `message-image-preview.test.ts` to assert the `100cqw` and `52cqw`
   dialog sizing strings.
2. Add negative assertions for the retired `100vw` and `52vw` image-preview
   sizing strings.
3. Update browser copy coverage to measure dialog backdrop space against the
   `overlay-shell` container instead of raw `window.innerWidth`.
4. Run the focused static test, overlay typecheck, real browser image-preview
   tests, screenshot review, self-review, commit, and push.

### Acceptance

- Image preview dialog width and copy-status max width are tested against the
  legal overlay container, not the raw viewport.
- No alternate image preview size source, fallback width, or duplicate panel
  sizing logic is introduced.
- Browser screenshots prove the mounted preview and localized toolbar remain
  readable inside the legal frame.

### Implementation

- `message-image-preview.test.ts` now asserts `100cqw` dialog width and `52cqw`
  copy-status width, with negative guards for the retired viewport-width
  strings.
- `image-preview-copy.test.ts` now verifies the preview dialog leaves backdrop
  space inside `document.body`'s `overlay-shell` container and checks that the
  shell is still an inline-size container.

### Verification

- PASS: `bun test packages/overlay/test/message-image-preview.test.ts packages/overlay/test/overlay-window-size-contract.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/image-preview-accessible-name.test.ts packages/overlay/test/browser/image-preview-copy.test.ts packages/overlay/test/browser/css-token-closure-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/image-preview-mounted-markdown-dialog.png`,
  `.scratch/image-preview-copy-status-zh-cn.png`, and
  `.scratch/image-preview-mounted-markdown-focus.png`.

### Self Review

- Rechecked `messages.css`: image preview dialog width and copy-status width
  use container query width units (`cqw`), not raw viewport width units.
- Rechecked `message-image-preview.test.ts`: old `100vw` and `52vw` literals
  are now negative guards rather than expected sizing sources.
- Rechecked browser coverage: the copy test measures backdrop space against the
  legal `overlay-shell` container instead of `window.innerWidth`, so the visual
  acceptance path no longer treats illegal viewport width as the source.
- Independent read-only audit found no high-confidence image-preview dead CSS
  to delete in this round.
