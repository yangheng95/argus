# Browser Preview Evidence Live Snapshot Boundary

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- PNG: Portable Network Graphics, the binary image format returned by browser preview routes.
- UI: User Interface, the visible overlay controls and preview stage.

## Task Definition

Stop Browser Preview from requesting and decoding live snapshot PNGs when the
selected task target already has persisted evidence for the selected viewport,
or when rendered verification evidence is the current preview owner.

## Recall

| Source                                                     | Constraint carried forward                                                                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                | No fallback, no dual source, test every change, visually verify UI changes, and keep Node as the Playwright runner on Windows.                     |
| `2026-06-11-browser-preview-interactive-live-session.md`   | Live preview is an interactive backend-owned browser session; evidence capture remains a separate diagnostic surface backed by the same target ID. |
| `2026-06-15-browser-preview-live-target-boundary.md`       | Live preview must never mix task and target IDs; failures should re-resolve the task-scoped target, not invent replacements.                       |
| `2026-06-19-browser-preview-loading-status-live.md`        | Live loading remains a real async surface, but only for live preview ownership.                                                                    |
| `2026-06-22-browser-preview-evidence-previewable-image.md` | Persisted evidence screenshots render through `PreviewableImage`; live screenshots remain direct only because they route interactive input.        |
| `2026-06-22-browser-preview-selected-target-probe.md`      | The selected persisted target is the single target authority; older candidates are not fallback owners.                                            |

## Call Point Inventory

| Surface                                            | Evidence                                                                                                                         | Decision                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `BrowserPreviewPanel.tsx` `latestEvidence`         | The resource source directly reads `currentTarget()?.latestEvidenceIDs?.[viewportID()]`.                                         | Extract this source into `latestEvidenceScope` so evidence ownership is available before the resource resolves. |
| `BrowserPreviewPanel.tsx` `renderedEvidence`       | The stage renders persisted evidence before `liveImageUrl()`.                                                                    | Keep visual precedence, but make request ownership match this precedence.                                       |
| `BrowserPreviewPanel.tsx` `liveScope`              | It currently becomes ready as soon as panel, task, directory, target, and viewport are ready.                                    | Return `undefined` while `latestEvidenceScope()` exists or `renderedEvidence()` exists.                         |
| `BrowserPreviewPanel.tsx` live input handlers      | Pointer, wheel, and key input call `sendLiveInput()` only when `liveScope()` and `liveImage()` match.                            | Preserve interactive live behavior when no persisted evidence owns the selected viewport.                       |
| `packages/overlay/src/services/browser-preview.ts` | `loadTaskBrowserPreviewLiveSnapshotObjectUrl()` and `sendTaskBrowserPreviewLiveInputObjectUrl()` are route clients only.         | Leave service contracts unchanged; do not add client-side request fallback or route-level gates.                |
| `browser-preview-evidence.test.ts`                 | The persisted viewport test visually proves evidence wins, but the fixture route still permits unnoticed live snapshot requests. | Record `/live/snapshot` requests and assert persisted evidence opens with none.                                 |
| `browser-preview-panel.test.ts`                    | Static guard already checks evidence-before-live stage order.                                                                    | Add source guard requiring live scope to be suppressed by evidence ownership and verification ownership.        |

## Root Cause

`BrowserPreviewPanel` had separate visual and network ownership rules. The
stage `Switch` displayed persisted evidence before live preview, but `liveScope`
was computed earlier and only checked readiness. Opening a task with
`latestEvidenceIDs` could therefore schedule a live snapshot request and binary
decode even though the UI would render persisted evidence. That is a dual-source
preview owner: evidence owns the stage while live snapshot still consumes
toolbar-open work.

## Fix Plan

1. Extract `latestEvidenceScope` from the evidence resource source.
2. Make `latestEvidence` consume `latestEvidenceScope`.
3. Make `liveScope` return `undefined` while persisted evidence is expected for
   the selected viewport or verification evidence actually owns the preview.
4. Add static guards for the ownership boundary.
5. Extend the real browser evidence test so initial persisted evidence asserts
   zero `/live/snapshot` requests.
6. Run focused unit tests, overlay typecheck, Node browser test, visual review,
   self-review, commit, and push.

## Acceptance

- Persisted evidence for the selected viewport prevents live snapshot requests.
- Rendered verification evidence prevents live snapshot requests while that evidence owns the stage.
- Live preview still loads and accepts input when no persisted evidence or verification owns the selected viewport.
- No service fallback, iframe, URL guessing, route gate, or alternate preview source is introduced.
- Focused static tests, overlay typecheck, browser evidence test, and visual screenshot review pass.

## Implementation Notes

- `BrowserPreviewPanel` now exposes the selected persisted evidence owner as
  `latestEvidenceScope`.
- `latestEvidence` consumes that same scope, so persisted evidence loading and
  preview ownership share one source.
- `liveScope` returns no live owner while persisted evidence or rendered
  verification evidence owns the selected target/viewport.
- The live service client and backend route contracts remain unchanged.

## Verification

- `bun test packages/overlay/test/browser-preview-panel.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-evidence.test.ts`
- Visual evidence reviewed:
  `.scratch/browser-preview-persisted-evidence-no-live.png`.

## Self Review

- Rechecked `BrowserPreviewPanel.tsx`; live ownership is disabled before
  `loadLiveFrame()` can schedule a request when `latestEvidenceScope()` or
  `renderedEvidence()` exists.
- Rechecked the browser fixture; the persisted evidence test records
  `/live/snapshot` request bodies and asserts the list is empty.
- Rechecked service boundaries; no fallback path, iframe, URL override, route
  gate, or alternate preview source was added.

## Codex Review Feedback

The later live-input visual stress repair found that suppressing live preview for
the whole `currentVerificationRequest()` was too broad. A pending auto-capture
request is status-row work, not necessarily the stage owner. The corrected owner
boundary is persisted evidence or rendered verification evidence. This preserves
the no-dual-source rule once evidence owns the stage, while allowing active live
preview to remain visible during long-running capture.
