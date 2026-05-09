# Workspace Editor Dropdown - 2026-05-09

## Recall

- Prior titlebar/workspace plan files referenced by repository history were not present on disk in the current worktree, so recall proceeded from the live implementation and existing UI ownership rule in `AGENTS.md`.
- The current work area already has `#solidWorkspaceEditorLaunchers` in `.workspace-command-dock`, physically next to the existing VS Code / PyCharm buttons. That is the correct owner surface for "open this workspace in an IDE".
- The Project menu `Recent` section uses generic menu item meta text; long paths currently compete with project names and visually drift.

## Target

- Replace the two quick IDE buttons in the workspace command dock with a single dropdown-style control that lists every supported project editor.
- Remove the duplicate editor list from the Project titlebar menu.
- Align Project menu recent rows so the project name and path columns are stable and long paths truncate cleanly.

## Acceptance

- Opening a project in an IDE still routes through `openDirectoryInEditor(editorID)`.
- The dropdown is disabled when no workspace directory is selected.
- Recent project rows render as a two-column layout with a stable left-aligned path column.
- The working-directory breadcrumb remains free of editor controls.
- Targeted tests and Vite build pass; visual review covers the Project menu and workspace command dock.
