# Right Sidebar OpenCode TUI Upgrade

Date: 2026-06-04

Detailed implementation plan: `specs/new-arch/right-sidebar-opencode-tui-copy-implementation-plan-2026-06-04.md`

## Source Baseline

- Upstream: `anomalyco/opencode` `dev` branch at `789e4d57b9d7af136cfc88feeb72fe81e4e28009`
- Upstream commit time: `2026-06-04T10:55:22-04:00`
- Local branch inspected: `coding-assistant`
- Upstream TUI files: 165 files under `packages/opencode/src/cli/cmd/tui`
- Local TUI files: existing OpenTUI implementation under `packages/opencorvus/src/cli/cmd/tui`, plus TUI runtime/control APIs under `packages/opencorvus/src/tui`

## Hard Finding

The current right sidebar coding assistant UI is hand-written browser UI:

- `packages/overlay/src/components/CodingAssistantPanel.tsx`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/overlay/src/services/coding-assistant-transcript.ts`
- `.coding-assistant-*` CSS in `packages/overlay/src/styles/surfaces/inspector.css`

This is not equivalent to opencode TUI and must not be accepted as the TUI implementation.

## Dependency Gap

Upstream uses the catalog versions:

- `@opentui/core`: `0.3.1`
- `@opentui/solid`: `0.3.1`
- `@opentui/keymap`: `0.3.1`
- `opentui-spinner`: `0.0.6`

Local currently uses:

- `@opentui/core`: `0.1.81`
- `@opentui/solid`: `0.1.81`
- no `@opentui/keymap` dependency
- `opentui-spinner`: `0.0.6`

The right sidebar TUI work must update the OpenTUI stack rather than adding more browser-only UI.

## Upstream Features To Reuse

The latest opencode TUI moved the important extension points into a plugin-slot architecture:

- `plugin/api.tsx`: exposes stable TUI state, route, keymap, dialog, prompt, toast, client, theme, and slot APIs.
- `plugin/runtime.ts`: loads internal and external TUI plugins, scopes lifecycle cleanup, and registers slots.
- `plugin/slots.tsx`: uses OpenTUI/Solid slot registry so sidebar/home/session surfaces can be extended without hard-coded JSX.
- `feature-plugins/sidebar/*`: splits Context, Files, LSP, MCP, Todo, and Footer into internal TUI plugins.
- `keymap.tsx`: replaces ad hoc key handling with `@opentui/keymap`, command registration, command palette, slash commands, leader key handling, and mode stack.
- `routes/session/sidebar.tsx`: renders sidebar shell and defers content/footer/title to slots.
- `routes/session/index.tsx`: uses command/keymap layers, improved subagent rendering, collapsible shell output, path formatting, retry dialogs, thinking modes, and plugin routes.

These are the pieces to port. Copying visual markup alone is not enough.

The upstream web/desktop surfaces also avoid hand-written terminal rendering:

- `packages/app/src/components/terminal.tsx`: embeds `ghostty-web`, not a custom ANSI renderer.
- `packages/app/src/context/terminal.tsx`: owns workspace-scoped PTY tabs, persistence, resize/update, clone/recovery, and close behavior.
- `packages/app/src/pages/session/terminal-panel.tsx`: hosts terminal tabs as a real terminal panel.
- `packages/app/src/utils/terminal-writer.ts`: batches terminal writes.
- `packages/desktop/package.json`: uses `@lydell/node-pty` optional native packages.

For the right sidebar, this means a valid in-panel TUI host should use a mature terminal renderer plus PTY/websocket transport. Starting a separate external terminal window is a control-plane feature, not the right-sidebar TUI surface.

## Local Call Points Found By Grep

TUI runtime/control:

- `packages/opencorvus/src/tui/index.ts`
- `packages/opencorvus/src/tui/runtime.ts`
- `packages/opencorvus/src/server/routes/tui.ts`
- `packages/opencorvus/src/server/routes/app.ts`
- `packages/opencorvus/src/cli/cmd/pr.ts`
- `packages/opencorvus/test/tui/runtime.test.ts`
- `packages/opencorvus/test/server/tui-control.test.ts`
- `packages/opencorvus/test/server/tui-command-routes.test.ts`
- `packages/opencorvus/test/server/session-select.test.ts`

Current hand-written right sidebar assistant:

- `packages/overlay/src/main.tsx`
- `packages/overlay/src/index.html`
- `packages/overlay/src/components/RightPanelTabs.tsx`
- `packages/overlay/src/components/CodingAssistantPanel.tsx`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/overlay/src/services/coding-assistant-transcript.ts`
- `packages/overlay/src/styles/surfaces/inspector.css`
- `packages/overlay/test/coding-assistant-panel.test.ts`
- `packages/overlay/test/coding-assistant-service.test.ts`
- `packages/overlay/test/api-directory-injection.test.ts`

Project-bound session and panel tool surface:

- `packages/opencorvus/src/coding-assistant/session.ts`
- `packages/opencorvus/src/server/routes/coding.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/test/server/coding-routes.test.ts`
- `packages/opencorvus/test/tool/panel.test.ts`
- `packages/opencorvus/test/tool/panel-capability.test.ts`
- `packages/opencorvus/test/protocol/session-mirror.test.ts`
- `packages/opencorvus/test/session/session.test.ts`

## Replacement Plan

1. Delete the hand-written browser transcript/composer implementation.
2. Upgrade OpenTUI dependencies to upstream-compatible `0.3.1` and add `@opentui/keymap`.
3. Port the TUI keymap foundation from upstream:
   - `keymap.tsx`
   - TUI config keybind schema/migration pieces needed by `keymap.tsx`
   - command palette replacement for local `dialog-command`
4. Port plugin slots:
   - `packages/plugin/src/tui.ts` type surface, renamed to `@opencorvus-ai/plugin/tui`
   - `packages/opencorvus/src/cli/cmd/tui/plugin/api.tsx`
   - `packages/opencorvus/src/cli/cmd/tui/plugin/runtime.ts`
   - `packages/opencorvus/src/cli/cmd/tui/plugin/slots.tsx`
   - internal plugin registry
5. Convert local session sidebar from hard-coded sections to `TuiPluginRuntime.Slot`:
   - `sidebar_title`
   - `sidebar_content`
   - `sidebar_footer`
6. Port internal sidebar feature plugins and adapt names/types to OpenCorvus:
   - context
   - files
   - LSP
   - MCP
   - todo
   - footer
7. Add an OpenCorvus internal sidebar plugin for project-bound agent-team controls.
8. Make the overlay right panel an OpenTUI host/terminal host for the existing TUI runtime instead of a custom chat panel.
   - Preferred browser-side renderer: adapt upstream `ghostty-web` terminal component and writer.
   - Preferred process transport: add a single server-side PTY/session API compatible with OpenCorvus auth and project directory scoping.
   - The TUI process must run the canonical OpenTUI app; the overlay only renders the terminal stream and forwards input/resize.
9. Keep project-bound session routes only as runtime/session binding APIs; do not render browser transcript UI.

## Required Project-Bound TUI Tool Surface

The side TUI must expose capability through one source: the existing project-scoped server/tool APIs plus TUI plugin state. Required actions:

- `query_project`: read project directory, config path, worktree, branch, provider readiness, and active workspace.
- `query_agent_team`: list active task agents, sessions, statuses, current tool activity, retry/error state, and current executor/agent model.
- `query_task`: read task board items, selected task, goal workflows, pending permissions/questions, and latest agent activity.
- `select_task`: focus a task in the project panel.
- `select_session`: navigate the TUI to a session.
- `send_task_message`: send a message to an existing task/session through the canonical session/task path.
- `create_task`: create a project task from the side TUI.
- `retry_task`: retry failed task work using existing scheduler/task APIs.
- `cancel_task`: cancel queued/running task work where the existing tool contract permits it.
- `set_executor`: choose the default executor for new project tasks.
- `show_toast`: visible feedback in the TUI.
- `execute_tui_command`: dispatch registered TUI keymap command by name.

Do not expose browser-only local state as a second source. If a capability is visible in the TUI, it must come from `api.state`, `api.client`, `TuiRuntime`, or `PanelTool`.

## Test Requirements

- Unit: dependency/config parsing accepts OpenTUI `0.3.1` stack and keymap config.
- Unit: plugin runtime loads internal sidebar plugins and disposes lifecycle hooks.
- Unit: `Sidebar` renders slot-hosted content, not hard-coded MCP/LSP/Todo/Diff blocks.
- Unit: right-sidebar capabilities match the allowed action set and reject forbidden panel actions.
- Integration: `/tui/runtime/start`, `/tui/runtime/status`, `/tui/runtime/proxy`, `/tui/runtime/submit-task`, and `/tui/runtime/task-status`.
- Overlay: assistant tab mounts runtime host only and does not import `CodingAssistantPanel`.
- E2E: opening the right sidebar starts or connects to project-bound TUI runtime and can run a task-status query with visible session output.
- Visual: OpenTUI surface must be visually rendered; no headless-only benchmark for TUI acceptance.

## Independent Review Feedback

Reviewer 1 confirmed the main architectural finding: the upstream value is not a single pretty sidebar component, but keymap, plugin runtime, slot API, sync/session rendering, and sidebar feature plugins. The local hand-written browser transcript/composer and local hard-coded TUI sidebar sections must be removed, not patched.

Reviewer 2 confirmed the right sidebar host gap: current `Tui.spawn()` launches an external terminal window on Windows and therefore cannot satisfy "TUI inside the right sidebar". The implementation must add an embedded PTY attach/stream path so the overlay can render the canonical OpenTUI process in-panel. The reviewer suggested `xterm.js`; upstream evidence prefers `ghostty-web` because opencode already uses it for its web terminal. The final implementation should use one mature terminal renderer, not both.

Reviewer 3 confirmed this is a grouped migration. It affects dependency catalog, `packages/opencorvus/package.json`, `packages/plugin/package.json`, `bun.lock`, TUI config schema, keymap parsing, plugin exports, plugin loader/runtime, build scripts, command routes, and overlay tests. It is not safe to only bump `@opentui/core` and `@opentui/solid`.

Additional required migration files from upstream:

- `packages/opencode/src/cli/cmd/tui/keymap.tsx`
- `packages/opencode/src/cli/cmd/tui/layer.ts`
- `packages/opencode/src/cli/cmd/tui/config/*`
- `packages/opencode/src/cli/cmd/tui/plugin/*`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/*`
- `packages/plugin/src/tui.ts`
- plugin loader/support files required by `TuiPluginRuntime`

Known local risk points:

- `packages/opencorvus/src/cli/cmd/tui/context/keybind.tsx`
- `packages/opencorvus/src/util/keybind.ts`
- `packages/opencorvus/src/cli/cmd/tui/component/dialog-command.tsx`
- `packages/opencorvus/src/tui/command.ts`
- `packages/opencorvus/src/config/tui.ts`
- `packages/opencorvus/script/build.ts`
- `packages/opencorvus/script/build.local.ts`
- `packages/overlay/src/components/CodingAssistantPanel.tsx`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/overlay/src/services/coding-assistant-transcript.ts`

## Non-Goals

- Do not clone opencode as a vendored runtime.
- Do not hand-write a replacement transcript/composer in browser CSS.
- Do not keep old and new right-sidebar assistant implementations in parallel.
- Do not introduce fallback UI for missing TUI runtime; surface the real runtime error.
