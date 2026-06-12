# Center Workbench Header Alignment - 2026-06-11

## Problem

The center workbench used the shared `oc-surface-header` only for Workflow, Inspector, and Notifications. Explorer, Files/Changes, and Preview started directly with their local controls, so they had no solid title bar. The shared workbench wrapper also added padding around center activities, which pushed Inspector and Notifications headers down from the top edge.

## Call Points Checked

| Surface | Source | Decision |
| --- | --- | --- |
| Workflow | `packages/overlay/src/index.html` | Keep existing `chat-header oc-surface-header`. |
| Inspector | `packages/overlay/src/index.html` | Keep existing `sections-header oc-surface-header`; remove wrapper offset. |
| Notifications | `packages/overlay/src/index.html` | Keep existing `sections-header oc-surface-header`; remove wrapper offset. |
| Explorer | `packages/overlay/src/components/FileExplorerPanel.tsx` | Add `SurfaceHeader` with `explorer.title`; keep search in body toolbar. |
| Files/Changes | `packages/overlay/src/components/FileChangesPanel.tsx` | Add `SurfaceHeader` with `section.files`; move Changes/Diff tabs into header actions. |
| Preview | `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Add `SurfaceHeader` with `browser_preview.title`; move refresh into header actions. |

## Implementation

Use the existing `SurfaceHeader` primitive as the single source for panel title bars. Remove center activity padding so headers touch the panel top, then add body padding only to content toolbars/bodies that need spacing.

## Verification

Add `packages/overlay/test/center-workbench-header-consistency.test.ts` to assert the center workbench panels use `SurfaceHeader` and the shell no longer offsets headers.
