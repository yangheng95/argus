# Browser Preview Evidence Stage Priority - 2026-06-17

## Acronyms

- DOM: Document Object Model, the browser's live tree of rendered elements.
- GUI: Graphical User Interface, the visible overlay preview panel.
- PNG: Portable Network Graphics, the screenshot image returned by preview evidence routes.
- UI: User Interface, the controls and rendered state users operate.

## Problem

`BrowserPreviewPanel` can have both a live snapshot object URL and persisted
evidence for the selected viewport. The stage `Switch` renders
`liveImageUrl()` before `renderedEvidence()`, so Solid renders the live branch
and never mounts `[data-ui="browser-preview-evidence"]` or
`[data-ui="browser-preview-screenshot"]`.

The capture evidence still appears in the header status and the PNG route is
requested, but the primary stage remains the live screenshot. That makes the
visual evidence artifact invisible in the GUI surface that should be reviewed.

## Evidence Sweep

Command:

```powershell
rg -n "liveImageUrl|renderedEvidence|data-ui=\"browser-preview-screenshot\"|browser-preview-live-screenshot|browser-preview-evidence-status" packages/overlay/src/components/BrowserPreviewPanel.tsx packages/overlay/test/browser/browser-preview-evidence.test.ts packages/overlay/test/browser-preview-panel.test.ts specs/new-arch -g "*.tsx" -g "*.ts" -g "*.md"
```

Findings:

| Surface              | Evidence                                                                                                        | Decision                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Stage branch order   | `BrowserPreviewPanel.tsx` matches `liveImageUrl()` before `renderedEvidence()`.                                 | Render evidence before live when evidence exists.                             |
| Evidence image route | `loadTaskBrowserPreviewEvidenceCaptureObjectUrl` already loads the persisted PNG through the task-scoped route. | Keep service contract unchanged.                                              |
| Live image route     | `loadTaskBrowserPreviewLiveSnapshotObjectUrl` remains a live interaction surface.                               | Keep live for no-evidence states; do not use it as acceptance evidence.       |
| Browser test         | Existing test checks live screenshot and evidence route usage, but not evidence stage visibility.               | Add DOM/image-loaded assertions for `[data-ui="browser-preview-screenshot"]`. |
| Source test          | Existing source test checks selector presence only.                                                             | Add ordering guard: evidence branch must precede live branch.                 |

## Fix

1. Move the `renderedEvidence()` branch before the `liveImageUrl()` branch in
   the stage `Switch`.
2. Keep status/header behavior and all backend service routes unchanged.
3. Add source-level ordering coverage so live cannot regain precedence.
4. Extend the browser evidence test so captured and persisted evidence must
   mount as the stage image while live remains available before evidence.

## Acceptance

- When evidence exists for the selected viewport, the stage renders
  `[data-ui="browser-preview-evidence"]`.
- The evidence PNG image `[data-ui="browser-preview-screenshot"]` is loaded
  with positive natural dimensions.
- The stage no longer shows `[data-ui="browser-preview-live"]` while evidence
  is the selected viewport's rendered artifact.
- Live screenshot remains available before evidence is present.
- Overlay source/browser tests, typecheck, i18n, and a real screenshot review pass.
