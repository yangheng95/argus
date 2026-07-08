# Codex Message Panel Titlebar Toolbar Repair

## Recall

- User request on 2026-07-08: "抄codex的消息面板，支持右侧打开toolbar，删除toolbar hover逻辑。然后把之前删除的ide打开项目的快捷键还原到标题栏上。注意运行时间永远相对于消息面板正中间".
- User correction after first implementation pass: "让你加到消息面板的标题栏". Therefore the IDE launcher and right-toolbar toggle belong in `.chat-header`, not the global window `.titlebar`.
- Immediate correction: the red block seen on hover is not a confirmed delete-second-confirm state. The current code has direct hover/focus expansion rules for `#solidRightActivityToolbar`; that is the observed mechanism to remove.
- Hard constraints read from `AGENTS.md`: no fallback/compatibility path, no blind patching, inspect existing specs before edits, write a Recall before implementation, preserve unrelated dirty worktree changes, use tests, and visually verify frontend changes without restarting the user's running OpenCorvus/overlay process.
- Existing records read before implementation:
  - `2026-07-08-cwd-project-control-right-toolbar.md`: top cwd/project controls were removed; runtime controls moved to right toolbar.
  - `2026-07-08-right-toolbar-runtime-status-panel-merge.md`: the right toolbar trailing slot is now the single runtime status dropdown.
  - `2026-07-08-composer-file-loader-right-toolbar-hover.md`: today's prior hover reveal implementation; this task supersedes its hover reveal section.
  - `2026-07-08-overlay-coding-cli-shortcut-removal.md`: coding CLI shortcut removal is separate from IDE project opening.
- Grep evidence:
  - `#solidRightActivityToolbar:hover` and `#solidRightActivityToolbar:focus-within` in `packages/overlay/src/styles/surfaces/activity.css` expand the toolbar from a narrow hover strip.
  - `WorkspaceEditorLaunchers` still owns IDE project opening through `openDirectoryInEditor`; before this repair it was not mounted in the message-panel titlebar / `.chat-header`.
  - `App.tsx` already owns titlebar Solid portals for brand/menu/window/connection/status mounts.
  - `chat-header.oc-surface-header` uses a 3-track grid, while `conversation.css` has a narrow-container rule that hides `.chat-header-status`.

## Implementation Plan

1. Add message-panel titlebar mount points for IDE launchers and a right-toolbar toggle inside `.chat-header-meta`.
2. Mount the existing `WorkspaceEditorLaunchers` in the message-panel titlebar so the IDE open-project shortcut reuses the current host/editor service path.
3. Add one shared right-toolbar signal and one message-panel titlebar button that toggles it.
4. Bind `#solidRightActivityToolbar` to `data-open`, remove hover/focus expansion CSS, and reveal the toolbar only when `data-open="true"`.
5. Keep right activity selection behavior unchanged; selecting an activity while the toolbar is open still toggles the corresponding center-workbench panel.
6. Keep the chat runtime/status pill in the center grid track at all widths; remove the responsive rule that hides it.
7. Update focused source tests to assert the new explicit-open contract and the restored message-panel titlebar IDE mount.
8. Run focused tests, perform browser screenshot verification in an isolated fixture, and do a second review of changed files.

## Acceptance

- Hovering the hidden right edge cannot reveal the toolbar.
- Clicking the message-panel titlebar toolbar button opens/closes the right toolbar and exposes its activity buttons.
- The IDE launcher appears in the message-panel titlebar and continues to use `WorkspaceEditorLaunchers`.
- The runtime elapsed/status pill remains centered in the message panel header.
- No duplicate IDE-open implementation is introduced.
- No fallback path or second toolbar state source is introduced.
