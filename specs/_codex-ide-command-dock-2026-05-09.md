# IDE Command Dock Integration

Date: 2026-05-09

## Problem

The IDE quick-open buttons are currently injected into the CWD breadcrumb as text shortcuts (`VS`, `Py`). That makes editor launching look like a side effect of the directory picker, and the workspace pane controls still read as an attachment to that same row rather than an owned panel control surface.

## Target

- Keep the CWD breadcrumb focused on directory selection, browsing, creation, and path opening only.
- Move IDE quick-open controls into a dedicated workspace command dock on the task panel.
- Render quick IDE actions with brand-like icon glyphs through the shared `Icon` primitive, not text abbreviations.
- Keep left/workspace/right pane visibility controls in the same dedicated command dock, separated from project path content.
- Verify by targeted unit/UI tests, production build, and a visual screenshot.

## Implementation Notes

- [x] Add `WorkspaceEditorLaunchers` as the owner for quick editor buttons.
- [x] Add editor logo icon names to `Icon.tsx` so SVGs remain single-source.
- [x] Remove quick editor markup from `pathBreadcrumb()`.
- [x] Add `#solidWorkspaceEditorLaunchers` and `.workspace-command-dock` to the task-bar structure.
- [x] Update tests to assert that IDE launchers live in the command dock and no `Py`/`VS` text remains in the breadcrumb.
- [x] Verify with i18n check, typecheck, targeted UI/unit tests, architecture guards, production build, and a screenshot.
