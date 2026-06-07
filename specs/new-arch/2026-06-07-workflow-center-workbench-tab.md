# Workflow Center Workbench Tab - 2026-06-07

## Problem

The message panel is still a fixed `chat` column labelled Conversation while toolbar panels use the closable center workbench tabs and the shared `centerWorkbenchWidth`. The coding assistant activity reuses the same message surface, but the header does not say Assistant.

## Call Points

| Area | File | Decision |
| --- | --- | --- |
| Message panel DOM | `packages/overlay/src/index.html` `chatSection` | Move the chat section into a `centerWorkbenchWorkflow` view so Workflow is a center workbench tab, not a permanently mounted sibling. |
| Center workbench state | `packages/overlay/src/main.tsx` `CenterWorkbenchTab`, `centerWorkbenchTabs`, `activeCenterWorkbenchTab` | Add `workflow`, default it open/active, and let it close through the same tab close path as Explorer/Diff/Browser/File. |
| Right toolbar | `packages/overlay/src/main.tsx` `RIGHT_ACTIVITIES`, `selectRightActivity()` | Add a Workflow toolbar activity that opens the `workflow` tab. Assistant activity opens the same `workflow` tab after selecting the assistant session. |
| Message title | `packages/overlay/src/main.tsx` `chatViewTitle` effect and i18n | Rename normal message title to Workflow. When `isCodingAssistantSource()` is true, render Assistant. |
| Shared width | `packages/overlay/src/styles/surfaces/workspace.css` | Reuse `--ui-center-workbench-width` for Workflow because it is now a center workbench view. Keep the existing center workbench resizer as the only width source. |
| Tests | `packages/overlay/test/*` | Update static and browser tests for default Workflow tab, closeability, toolbar entry, and Assistant title. |

## Constraints

- No new layout width source; Workflow uses existing `centerWorkbenchWidth`.
- No separate workflow-open state; open tabs remain the center workbench source.
- No duplicate conversation renderer; the existing `Conversation`, `ConversationAgentRail`, and `ChatComposer` move with the Workflow view.

## Verification

- `bun test --timeout 120000 packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/file-explorer-editor.test.ts`
- `bun test --timeout 120000 packages/overlay/test/side-activity-toolbar-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
