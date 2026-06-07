# Workflow Center Workbench Tab - 2026-06-07

## Problem

The message panel was a fixed `chat` column labelled Conversation while toolbar panels used the closable center workbench tabs. The follow-up correction is that Inspector and Notifications must not remain a separate right column: every right toolbar activity opens a peer center workbench view, and the center workbench fills the middle panel instead of leaving an empty conversation shell.

## Call Points

| Area | File | Decision |
| --- | --- | --- |
| Message panel DOM | `packages/overlay/src/index.html` `chatSection` | Move the chat section into a `centerWorkbenchWorkflow` view so Workflow is a center workbench tab, not a permanently mounted sibling. |
| Inspector DOM | `packages/overlay/src/index.html` `sections`, `rightPanelInspector` | Move the Inspector stack into `centerWorkbenchInspector`; remove the sibling right-panel column and right pane resizer from the default workspace layout. |
| Notifications DOM | `packages/overlay/src/index.html` `rightPanelNotifications` | Move the notification center into `centerWorkbenchNotifications` so it shares the same workbench tab system. |
| Center workbench state | `packages/overlay/src/main.tsx` `CenterWorkbenchTab`, `centerWorkbenchTabs`, `activeCenterWorkbenchTab` | Include `workflow`, `inspector`, `notifications`, `explorer`, `diff`, `browser`, and `file`; all closable views use the same tab close path. |
| Right toolbar | `packages/overlay/src/main.tsx` `RIGHT_ACTIVITIES`, `selectRightActivity()` | Toolbar buttons open center workbench tabs only. Assistant opens the same `workflow` tab after selecting the assistant session. |
| Message title | `packages/overlay/src/main.tsx` `chatViewTitle` effect and i18n | Rename normal message title to Workflow. When `isCodingAssistantSource()` is true, render Assistant. |
| Shared width | `packages/overlay/src/styles/surfaces/workspace.css`, `packages/overlay/src/styles/surfaces/inspector.css` | Let `centerWorkbench` fill the middle panel; Inspector/Notifications/Workflow all consume that same workbench width and no longer create an extra right column. |
| Tests | `packages/overlay/test/*` | Update static and browser tests for default Workflow tab, closeability, toolbar entry, and Assistant title. |

## Constraints

- No separate right-panel width source in the default workspace; right toolbar activities share the center workbench surface.
- No separate workflow-open state; open tabs remain the center workbench source.
- No duplicate conversation renderer; the existing `Conversation`, `ConversationAgentRail`, and `ChatComposer` move with the Workflow view.
- No persistent Inspector column; Inspector opens only through its toolbar activity or an existing workbench tab.

## Verification

- `bun test --timeout 120000 packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/file-explorer-editor.test.ts`
- `bun test --timeout 120000 packages/overlay/test/side-activity-toolbar-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
