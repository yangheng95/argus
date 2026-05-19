# Overlay agent rail and file opening simplification

Date: 2026-05-19

## User request

- Remove the agent rail expand behavior. The rail should not offer a wide/expanded mode.
- Remove the built-in open behavior for files, excluding diffs.
- File links should open in the IDE selected from the top-right editor launcher.

## Recall and constraints

- `AGENTS.md` delegates to `CLAUDE.md`.
- Current request overrides the older rail design in `specs/new-arch/2026-05-13-conversation-agent-workflow-rail.md`, where the rail was specified as draggable/taller with a report dialog.
- `specs/new-arch/2026-05-16-overlay-message-turn-agent-cards.md` remains relevant for card projection; this change does not alter agent card generation.
- No fallback logic. Diff opening remains on the workspace diff path because the user explicitly excluded diffs.

## Callpoint inventory

Agent rail expansion:

- `packages/overlay/src/components/ConversationAgentRail.tsx`: wide height state, resize pointer handler, trace fetch tied to `wide`, latest message rendering, report button, and `AgentReportDialog` mount.
- `packages/overlay/src/components/AgentReportDialog.tsx`: report popup used only by the expandable rail.
- `packages/overlay/src/styles/surfaces/conversation.css`: wide-mode selectors, resize handle, run/report UI, report dialog styles, mobile hiding for wide-only controls.
- `packages/overlay/test/*`: static guard tests for rail CSS and report dialog.

Built-in file opening:

- `packages/overlay/src/main.tsx`: `openWorkspaceFile` and delegated `[data-file-path]` click handler.
- `packages/overlay/src/components/WorkspacePanel.tsx`: file tab and `FileViewPanel` view.
- `packages/overlay/src/components/FileViewPanel.tsx`: built-in `/file/content` preview.
- `packages/overlay/src/styles/surfaces/workspace.css`: file-view panel styles and inline file link wording.
- `packages/overlay/src/components/WorkspaceEditorLaunchers.tsx`, `packages/overlay/src/services/workspace.ts`, settings storage: top-right selected IDE state and editor launch target.

## Implementation plan

1. Collapse `ConversationAgentRail` to a fixed narrow rail that renders only lane/avatar buttons and card locating.
2. Delete the rail expand-only report dialog and remove its CSS/test expectations.
3. Remove the workspace file preview view and file tab, preserving diff preview behavior.
4. Persist the top-right selected IDE and make file links open their target path through that selected editor.
5. Update static and behavioral tests so old expand/file-preview APIs cannot return.

## Acceptance

- No `conversation-agent-rail__resize`, `data-wide`, `AgentReportDialog`, or report-dialog CSS remains.
- No `openWorkspaceFile`, `FileViewPanel`, file workspace view, or `workspace.file*` strings remain.
- `openWorkspaceDiff` and diff preview remain intact.
- File links with `data-file-path` route to the selected project editor.
- Targeted overlay tests and `git diff --check` pass, with any unrelated failures called out explicitly.

## Verification

- PASS: `bun test packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/agent-workflow-css-guards.test.ts packages/overlay/test/delivery-panel-mount.test.ts`
- PASS: `bun test packages/overlay/test/workspace-editor.test.ts packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/primitives-panel-section.test.ts`
- PASS: `bun test packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/owner-surface-consistency.test.ts --test-name-pattern "workspace panel|conversation agent rail|owner surface"`
- PASS: `bun test packages/overlay/test/composer-routing-prefix.test.ts`
- PASS: `bun run --cwd packages/overlay typecheck`
- PASS: `bun run --cwd packages/overlay check:i18n`
- PASS: `bun run --cwd packages/overlay build:vite`
- PASS: `git diff --check`
- PASS: source residual scan for removed file-preview / rail-expand symbols in `packages/overlay/src`.
- FULL OVERLAY SUITE PARTIAL: `bun test packages/overlay/test --timeout 120000` reached 1354 pass / 14 fail before the prompt routing watermark fix. Rechecked and fixed the prompt watermark failure. The remaining observed failures are on pre-existing surfaces outside this change: ChatBubble static watermark, Playwright overlay controls/copying flows, flat-redesign CSS watermarks in dialog/sidebar/settings, provider settings/search sync, hotkey adoption count, task row icon shell, DeliveryPanel empty-hint migration, and titlebar column-resizer visual guard.
