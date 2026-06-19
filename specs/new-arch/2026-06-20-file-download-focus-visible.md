# File Download Focus Visible

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. UI means
User Interface.

## Problem

Independent GUI review found file attachment download links render as a
pill-like visible control with hover feedback but no tokenized keyboard
`:focus-visible` state. The link is semantically correct because it uses the
browser `download` attribute, but keyboard users do not get the same visible
state as pointer users.

## Recall

| Source | Existing decision |
| --- | --- |
| `packages/overlay/src/components/FilePart.tsx` | Non-previewable file parts render a `DownloadLink` anchor with `download={name}`. |
| `packages/overlay/src/styles/surfaces/messages.css` | `.msg-file-download` owns the visible pill chrome for file attachment downloads. |
| `2026-06-08-message-image-preview.md` | Image file parts route through the shared preview component; non-image file parts remain download chips. |
| `2026-06-20-markdown-link-focus-visible.md` | Rendered links need explicit tokenized focus-visible chrome at their shared surface owner. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "msg-file-download|FilePart|download=|focus-visible" packages/overlay/src/components packages/overlay/src/styles/surfaces/messages.css packages/overlay/test specs/new-arch` | `FilePart.tsx` has one `DownloadLink` owner; `messages.css` has base and hover styles but no focus-visible. | Add focus-visible to `messages.css`, not per caller. |
| `rg -n 'type: "file"|msg-file' packages/overlay/src packages/overlay/test` | Browser coverage for file-like message parts exists in screenshot panel tests, but no visual focus test for `.msg-file-download`. | Extend the existing real message fixture that already exercises links. |

## Fix

- Add `.msg-file-download:focus-visible` with tokenized color, transparent
  hover-equivalent background, outline, and outline offset.
- Keep the anchor semantics and `download` attribute unchanged.
- Extend `message-file-link-browser.test.ts` with a non-image file part and
  Tab-focus screenshot coverage for `.msg-file-download`.

## Acceptance

- Static coverage requires a `.msg-file-download:focus-visible` rule and rejects
  `outline: none`.
- Real browser coverage verifies focus-visible and non-empty outline.
- Screenshot `.scratch/message-file-download-focus-visible.png` shows the focused
  download chip.
