# Workflow Center Workbench Panels - 2026-06-07

## Problem

The message panel was a fixed `chat` column labelled Conversation while toolbar panels used a tab strip. The final correction is that the tab strip itself is the wrong primitive here: Workflow already owns its header and run status, so adding a second Workflow tab above it duplicates the label and hides the original status hierarchy. Right toolbar activities should open independent panels inside the middle workbench; every open panel shares the middle area equally.

## Call Points

| Area                   | File                                                                                                       | Decision                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message panel DOM      | `packages/overlay/src/index.html` `chatSection`                                                            | Keep Workflow as a workbench panel and restore its own `chat-header` as the only Workflow header.                                                       |
| Inspector DOM          | `packages/overlay/src/index.html` `sections`, `rightPanelInspector`                                        | Keep the Inspector stack in `centerWorkbenchInspector`; remove the sibling right-panel column and right pane resizer from the default workspace layout. |
| Notifications DOM      | `packages/overlay/src/index.html` `rightPanelNotifications`                                                | Keep the notification center in `centerWorkbenchNotifications` so it opens as a peer panel.                                                             |
| Center workbench state | `packages/overlay/src/main.tsx` `CenterWorkbenchPanel`, `centerWorkbenchPanels`                            | Replace tab state with an open-panel collection; multiple panels can be open at once.                                                                   |
| Right toolbar          | `packages/overlay/src/main.tsx` `RIGHT_ACTIVITIES`, `selectRightActivity()`                                | Toolbar buttons toggle panels. Active state means the panel is open, not that a tab is selected.                                                        |
| Message title          | `packages/overlay/src/main.tsx` `chatViewTitle` effect and i18n                                            | Normal message title is Workflow. When `isCodingAssistantSource()` is true, render Assistant while preserving the run-status header row.                |
| Shared width           | `packages/overlay/src/styles/surfaces/workspace.css`, `packages/overlay/src/styles/surfaces/inspector.css` | Let every `data-open=true` panel flex equally inside the middle workbench.                                                                              |
| Tests                  | `packages/overlay/test/*`                                                                                  | Update static and browser tests for no tab strip, panel toggling, equal-width split, meaningful toolbar icons, and Assistant title.                     |

## Constraints

- No separate right-panel width source in the default workspace; right toolbar activities share the center workbench surface.
- No tab strip. Open panels are the single source for visibility.
- No duplicate conversation renderer; the existing `Conversation`, `ConversationAgentRail`, and `ChatComposer` move with the Workflow view.
- No persistent Inspector column; Inspector opens only through its toolbar activity.

## Verification

- `bun test --timeout 120000 packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/file-explorer-editor.test.ts`
- `bun test --timeout 120000 packages/overlay/test/side-activity-toolbar-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
