# Message Pane Agent Rail Geometry And Toolbar Alignment

## Recall

- User request on 2026-07-08: "这条线是哪儿来的？你把消息区域居中收缩，给agent rail留下空间。右侧的toolbar的tool icon宽度和高度不够没有跟消息面板的header对齐".
- The visible vertical line is from `packages/overlay/src/styles/surfaces/conversation.css`: `.conversation-agent-rail-host` has `border-right`, gradient background, and inset shadow. Because the rail host is now inside `.conversation-body` before `.conversation-scroll-shell`, that border draws through the message pane.
- The message area currently uses `.chat-scroll { width: auto / full flex width }` inside `.conversation-scroll-shell`, so the message column is not a centered constrained lane beside the agent rail.
- The right toolbar mount width is `var(--ui-collapsed-pane-width)`, which maps to `var(--oc-header-height)`, but `.side-activity-toolbar [data-ui="side-activity-button"]` and `.project-runtime-toolbar-actions .oc-button[data-toolbar-compact="true"]` are hard-sized to `38px x 36px`, so icon buttons do not fully align with the message header height.
- Files/specs read before implementation: `AGENTS.md`, `2026-07-08-codex-message-panel-titlebar-toolbar.md`, `2026-07-08-conversation-agent-history-left-rail.md`, `packages/overlay/src/index.html`, `packages/overlay/src/styles/surfaces/conversation.css`, `packages/overlay/src/styles/surfaces/activity.css`, `packages/overlay/src/styles/surfaces/header.css`, `packages/overlay/src/styles/surfaces/workspace.css`, `packages/overlay/src/components/ConversationAgentRail.tsx`, `packages/overlay/src/components/SideActivityToolbar.tsx`, and `packages/overlay/src/components/TaskDirBar.tsx`.
- Grep evidence: `conversation-agent-rail-host`, `conversation-scroll-shell`, `chat-scroll`, `solidRightActivityToolbar`, `side-activity-button`, `project-runtime-toolbar-actions`, `oc-surface-header`, and `ui-collapsed-pane-width` all converge on the geometry above.

## Plan

1. Remove the rail host's border/background/shadow line. Keep the host as real reserved space and keep the existing `:empty { display: none }` behavior so rail space exists only when there is agent history content.
2. Center and constrain `.chat-scroll` within `.conversation-scroll-shell`, so the message lane shrinks in the available message pane while the agent rail keeps its reserved left slot.
3. Set right toolbar activity buttons and compact runtime button to `var(--ui-collapsed-pane-width)` for both width and height, using the same token as the toolbar width and message header height.
4. Update focused tests to assert the line-owning border is gone, the message lane is centered/constrained, and right toolbar buttons use the shared toolbar/header token.
5. Run focused unit/source tests, typecheck, Node browser verification with screenshots, visual review, and second diff review.

## Acceptance

- The vertical line under the Chat title is not produced by `.conversation-agent-rail-host`.
- Agent rail still reserves horizontal space when it has records, and disappears when empty through the existing empty host rule.
- The message scroll column is centered and width-constrained inside the message pane.
- Right toolbar tool buttons and compact runtime button are square and sized from `var(--ui-collapsed-pane-width)`.
- No fallback path, duplicate rail source, or DOM hack is introduced.
