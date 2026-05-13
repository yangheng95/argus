# Close Project Option - 2026-05-13

## Requirement

Add an operator-facing option to close the current project from the Overlay Project menu.

## Product Contract

- The option belongs to the Project menu because it controls the selected project/workspace directory, not the application window.
- Closing a project clears the active directory and the persisted saved directory.
- Closing a project clears project-scoped UI state: selected task, board snapshot, task list, pending tasks, path/VCS metadata, changes, config/provider/channel/prompt/executor/skill/MCP/memory projections.
- After close, the existing workspace onboarding dialog is the single entry point for opening or creating a project.
- Recent directories remain available so the user can reopen a project explicitly.
- The action must be disabled when no project directory is selected.

## Non-Goals

- Do not shut down the OpenCorvus server.
- Do not hide or close the application window.
- Do not delete project files, tasks, or database rows.
- Do not introduce a fallback directory or restore the server current working directory.

## Implementation Plan

- Add a `closeProject()` workspace service that is the only writer for the close-project lifecycle.
- Wire the Project menu item to `closeProject()`.
- Add i18n labels for English and Simplified Chinese.
- Cover the flow with a titlebar/onboarding integration test and targeted workspace service unit tests.

## Acceptance

- Clicking Project -> Close Project clears `settingsStore.directory` and persisted settings directory.
- API directory context becomes empty, so project-scoped requests are not sent against the old project.
- The onboarding dialog opens immediately after close.
- Existing recent directory entries are still displayed in onboarding.
- No stale task, board, VCS, or project config data remains visible after close.
