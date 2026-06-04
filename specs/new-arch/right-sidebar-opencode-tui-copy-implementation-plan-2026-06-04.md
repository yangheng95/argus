# Right Sidebar OpenCode TUI Copy Implementation Plan

Date: 2026-06-04
Reviewed again: 2026-06-05
Status: implementation plan, not yet implemented
Upstream baseline: `anomalyco/opencode` local snapshot `94c49b20ba207a92e4150c552d616930b6560e39`
Upstream license: MIT

## 0. Hard Acceptance

The right sidebar coding assistant must become an embedded OpenCode-style TUI host. The current browser transcript/composer is rejected and must be deleted, not patched.

Accepted outcome:

- The right sidebar tab is at the same level as file manager and other right-panel tools.
- The right sidebar renders the canonical OpenTUI process through a mature terminal renderer.
- TUI behavior comes from copied OpenCode TUI primitives: OpenTUI `0.3.1`, `@opentui/keymap`, plugin slots, internal feature plugins, command palette, and real PTY transport.
- Project binding is a first-class contract: project directory, assistant session, selected task, and agent team operations are tied to one durable TUI host identity.
- No browser-only transcript reducer, no hand-written textarea chat composer, no duplicate keymap system, no duplicate command route model.

Rejected outcome:

- A custom Solid/HTML panel that imitates OpenCode visuals.
- Keeping `CodingAssistantPanel` as fallback.
- Starting an external terminal window from the right sidebar.
- Adding another local keybinding, command palette, or sidebar plugin framework.

## 1. Evidence Baseline

### 1.0 Upstream freshness check

On 2026-06-05, local upstream `anomalyco/opencode` was refreshed from `origin/dev`.

- Previous inspected commit: `789e4d57b9d7af136cfc88feeb72fe81e4e28009`
- Current inspected commit: `94c49b20ba207a92e4150c552d616930b6560e39`
- New commits: `7f54b1b fix build`, `9f3a0fe chore: update nix node_modules hashes`, `94c49b2 make scripts executable`
- Checked paths: `packages/opencode/src/cli/cmd/tui`, `packages/app/src`, `packages/core/src/pty`, `packages/plugin`, root/package package manifests
- Result: no changes in OpenCode TUI, terminal host, PTY, plugin TUI API, or OpenTUI dependency versions since the prior inspected snapshot.

The copy plan remains valid against the current upstream snapshot. The baseline hash above is updated so implementation must copy from `94c49b20ba207a92e4150c552d616930b6560e39`, not the older `789e4d57b9d7af136cfc88feeb72fe81e4e28009`.

### 1.1 Upstream OpenCode modules to reuse

OpenCode's TUI is not just visual markup. The reusable value is in these modules:

- `packages/opencode/src/cli/cmd/tui/keymap.tsx`
- `packages/opencode/src/cli/cmd/tui/layer.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/api.tsx`
- `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/slots.tsx`
- `packages/opencode/src/cli/cmd/tui/plugin/internal.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/command-shim.ts`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/context.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/files.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/lsp.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/mcp.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/todo.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/system/which-key.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/system/plugins.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/system/session-v2.tsx`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/system/diff-viewer.tsx`
- `packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx`
- `packages/plugin/src/tui.ts`

For embedding the TUI into a browser right panel, OpenCode also provides a mature terminal host pattern:

- `packages/app/src/components/terminal.tsx`
- `packages/app/src/context/terminal.tsx`
- `packages/app/src/pages/session/terminal-panel.tsx`
- `packages/app/src/utils/terminal-writer.ts`
- `packages/core/src/pty/pty.node.ts`
- `packages/core/src/pty/pty.bun.ts`
- `packages/core/src/pty/schema.ts`
- `packages/core/src/pty/ticket.ts`

### 1.2 Upstream dependency target

OpenCode currently uses:

- `@opentui/core@0.3.1`
- `@opentui/solid@0.3.1`
- `@opentui/keymap@0.3.1`
- `@lydell/node-pty@1.2.0-beta.12`
- `ghostty-web`

OpenCorvus currently uses:

- `@opentui/core@0.1.81`
- `@opentui/solid@0.1.81`
- no `@opentui/keymap`
- no embedded terminal host for the right sidebar

The dependency update is mandatory. Copying code while staying on `0.1.81` creates a false port.

### 1.3 Current local code that must be replaced

Hand-written right sidebar assistant:

- `packages/overlay/src/components/CodingAssistantPanel.tsx`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/overlay/src/services/coding-assistant-transcript.ts`
- `.coding-assistant-*` rules in `packages/overlay/src/styles/surfaces/inspector.css`
- imports and tab wiring in `packages/overlay/src/main.tsx`
- tests under `packages/overlay/test/coding-assistant-panel.test.ts`

Local TUI mechanisms that duplicate upstream:

- `packages/opencorvus/src/cli/cmd/tui/context/keybind.tsx`
- `packages/opencorvus/src/util/keybind.ts`
- `packages/opencorvus/src/cli/cmd/tui/component/dialog-command.tsx`
- `packages/opencorvus/src/tui/command.ts`
- `/tui/execute-command` and command alias routes in `packages/opencorvus/src/server/routes/tui.ts`
- hard-coded sidebar sections in `packages/opencorvus/src/cli/cmd/tui/routes/session/sidebar.tsx`

External terminal runtime that cannot satisfy right-sidebar embedding:

- `packages/opencorvus/src/tui/index.ts`
- `packages/opencorvus/src/tui/runtime.ts`
- launch/status/stop tests that assume external terminal process behavior

### 1.4 Independent review findings

Parfit found the current right sidebar is a custom browser chat UI and not aligned with OpenCode's feature or experience maturity. Missing parts include embedded PTY, OpenTUI `0.3.1`, `@opentui/keymap`, slot runtime, command palette, and OpenCode sidebar feature plugins.

James found this is a grouped migration. Extending `CodingAssistantPanel` would create double sources. The single source must be upstream TUI keymap, upstream plugin slots, generated/canonical API clients, and a terminal host adapter. He also flagged `RIGHT_SIDEBAR_ASSISTANT_ALLOWED_ACTIONS` as a likely duplicate source if it remains separate from real tool capability metadata.

Plato found a deeper binding bug: canonical `/session/:sessionID/*` routes do not assert project/directory ownership, while the right sidebar later calls those canonical routes. During project switching, a stale right-sidebar session can read or write an old project. The TUI migration must fix session ownership, directory normalization, and project/task binding at the same time.

Mencius confirmed there must not be a new "side assistant session store". Existing `session/message/part`, `a2a_task_queue`, engine task store, and protocol store remain the sources for assistant conversation, prompt queueing, task state, and agent-team events. The new persistence gap is only the embedded TUI/terminal runtime: PTY attach, resize, input, lifecycle status, and bounded terminal snapshot/recovery.

## 2. Copy Strategy

### 2.1 Rule

Copy OpenCode modules first, then adapt names and contracts. Do not re-create an equivalent design from memory.

The copy must preserve:

- upstream file boundaries where possible;
- upstream keymap command model;
- upstream plugin slot API shape;
- upstream internal plugin registration style;
- upstream terminal renderer and PTY transport pattern.

Allowed adaptation:

- rename `opencode` package imports to `opencorvus`;
- replace OpenCode-specific client calls with OpenCorvus canonical SDK calls;
- replace OpenCode session/task types with OpenCorvus session/task/protocol types;
- replace OpenCode persistence helper with OpenCorvus storage;
- remove upstream features that depend on products OpenCorvus does not have, only when tests prove no import remains.

Forbidden adaptation:

- rewriting copied modules as a new browser component;
- replacing upstream keymap with local `useKeyboard`;
- replacing upstream slots with hard-coded JSX sections;
- keeping old command route aliases beside copied command registry;
- keeping a fallback transcript panel.

### 2.2 Copy set A: dependency and build substrate

Files to update:

- `package.json`
- `bun.lock`
- `packages/opencorvus/package.json`
- `packages/overlay/package.json`
- `packages/plugin/package.json`
- `packages/opencorvus/script/build.ts`
- `packages/opencorvus/script/build.local.ts`

Required changes:

- Upgrade `@opentui/core` and `@opentui/solid` to `0.3.1`.
- Add `@opentui/keymap@0.3.1`.
- Add `@lydell/node-pty@1.2.0-beta.12` or OpenCode's current PTY package set.
- Add `ghostty-web` to the overlay/app package that renders the terminal.
- Add or port OpenCode's node-pty postinstall/fix script only if native package resolution requires it on Windows.

Test gate:

- A dependency test must assert no `@opentui/*@0.1.81` remains.
- A package import test must assert `@opentui/keymap` is resolvable from the TUI package.

### 2.3 Copy set B: TUI plugin API and keymap

Copy from upstream:

- `packages/opencode/src/cli/cmd/tui/keymap.tsx`
- `packages/opencode/src/cli/cmd/tui/layer.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/api.tsx`
- `packages/opencode/src/cli/cmd/tui/plugin/runtime.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/slots.tsx`
- `packages/opencode/src/cli/cmd/tui/plugin/internal.ts`
- `packages/opencode/src/cli/cmd/tui/plugin/command-shim.ts`
- `packages/plugin/src/tui.ts`

Target files:

- `packages/opencorvus/src/cli/cmd/tui/keymap.tsx`
- `packages/opencorvus/src/cli/cmd/tui/layer.ts`
- `packages/opencorvus/src/cli/cmd/tui/plugin/api.tsx`
- `packages/opencorvus/src/cli/cmd/tui/plugin/runtime.ts`
- `packages/opencorvus/src/cli/cmd/tui/plugin/slots.tsx`
- `packages/opencorvus/src/cli/cmd/tui/plugin/internal.ts`
- `packages/opencorvus/src/cli/cmd/tui/plugin/command-shim.ts`
- `packages/plugin/src/tui.ts`

Rewrite points:

- Replace upstream client imports with OpenCorvus SDK/client imports.
- Map upstream `session`, `route`, `dialog`, `toast`, `prompt`, and `state` APIs to OpenCorvus TUI state.
- Keep the `@opentui/keymap` provider and command registry as the only keymap source.
- Move existing local command names into the upstream command registry shape.
- Delete `context/keybind.tsx`, `util/keybind.ts`, and `dialog-command.tsx` after copied modules compile.

Tests:

- Register a keymap layer and assert command dispatch.
- Register command slashes and assert slash command discovery.
- Assert leader key state is exposed by copied `useLeaderActive`.
- Assert local keybind files are not imported by any TUI source.
- Assert command palette comes from copied command registry, not `dialog-command.tsx`.

### 2.4 Copy set C: slot-based sidebar and internal plugins

Copy from upstream:

- `feature-plugins/sidebar/context.tsx`
- `feature-plugins/sidebar/files.tsx`
- `feature-plugins/sidebar/lsp.tsx`
- `feature-plugins/sidebar/mcp.tsx`
- `feature-plugins/sidebar/todo.tsx`
- `feature-plugins/sidebar/footer.tsx`
- `feature-plugins/system/which-key.tsx`
- `feature-plugins/system/plugins.tsx`
- `feature-plugins/system/session-v2.tsx`
- `feature-plugins/system/diff-viewer.tsx`
- `routes/session/sidebar.tsx`

Target files:

- `packages/opencorvus/src/cli/cmd/tui/feature-plugins/sidebar/*`
- `packages/opencorvus/src/cli/cmd/tui/feature-plugins/system/*`
- `packages/opencorvus/src/cli/cmd/tui/routes/session/sidebar.tsx`

Rewrite points:

- Replace OpenCode-specific names with OpenCorvus names without changing slot architecture.
- Convert hard-coded local sidebar sections into slot registrations:
  - `sidebar_title`
  - `sidebar_content`
  - `sidebar_footer`
  - `session_panel`
  - `status_footer`
- Keep Context, Files, LSP, MCP, Todo, Footer as internal plugins.
- Add one OpenCorvus internal plugin named `agent-team` for project-bound task/team controls.

Tests:

- Rendering `Sidebar` without plugins shows only shell structure and empty slot regions.
- Loading internal plugins renders Context, Files, LSP, MCP, Todo, Footer through slots.
- Disabling a plugin removes its slot output without modifying sidebar shell.
- No direct imports of local `TodoItem`, MCP, LSP, or file sections remain in `routes/session/sidebar.tsx`.

### 2.5 Copy set D: embedded terminal host and PTY transport

Copy/adapt from upstream app/core:

- `packages/app/src/components/terminal.tsx`
- `packages/app/src/context/terminal.tsx`
- `packages/app/src/pages/session/terminal-panel.tsx`
- `packages/app/src/utils/terminal-writer.ts`
- `packages/core/src/pty/pty.node.ts`
- `packages/core/src/pty/pty.bun.ts`
- `packages/core/src/pty/schema.ts`
- `packages/core/src/pty/ticket.ts`

Target files:

- `packages/overlay/src/components/RightSidebarTuiHost.tsx`
- `packages/overlay/src/components/TuiTerminal.tsx`
- `packages/overlay/src/services/tui-host.ts`
- `packages/overlay/src/services/tui-terminal-writer.ts`
- `packages/opencorvus/src/pty/*`
- `packages/opencorvus/src/tui/host.ts`
- `packages/opencorvus/src/server/routes/tui-host.ts`

Rewrite points:

- The right sidebar owns a browser terminal renderer only. It must not render assistant messages itself.
- The server owns the PTY process and launches the canonical OpenTUI app.
- Input, resize, exit, and output are transported over one project-scoped stream.
- Existing `Tui.spawn()` external window behavior is either deleted or moved to a separate explicit "open external TUI" action. It must not be the right-sidebar implementation.
- The overlay must use the generated/canonical client where possible. If streaming cannot use the generated client, the streaming service must still use canonical route definitions and typed event schemas.

Proposed server routes:

- `POST /tui/host/session`: claim or create the project-bound TUI host for the current `Instance.project.id` and normalized `Instance.directory`.
- `GET /tui/host/:sessionID/events`: stream terminal output, lifecycle events, and host errors.
- `POST /tui/host/:sessionID/input`: write terminal input.
- `POST /tui/host/:sessionID/resize`: resize PTY and persist dimensions.
- `POST /tui/host/:sessionID/close`: explicit PTY close.
- `GET /tui/host/:sessionID/snapshot`: read saved terminal snapshot.

The route key uses the assistant `sessionID` because the assistant session is the durable project-bound identity. There must not be a second durable host ID unless a later schema review proves one identity cannot encode the lifecycle.

Tests:

- Creating a host starts one PTY scoped to current project directory.
- Calling create twice for the same project/session attaches to the same host.
- Input reaches the PTY and output is visible on the event stream.
- Resize calls PTY resize and persists `cols` and `rows`.
- Closing the sidebar detaches the viewer and saves a snapshot without killing the PTY.
- Explicit close kills the PTY and marks host state closed.
- Windows path and normalized directory are asserted before attach.
- Starting the right sidebar must not call `cmd.exe /c start`, `open -a Terminal.app`, or Linux external terminal launchers.

## 3. Project, Task, and Agent-Team Binding

### 3.1 Durable identity

Use the existing assistant session as the durable TUI identity:

- `session.id`: durable assistant/TUI session ID.
- `session.projectID`: project owner.
- `session.directory`: normalized workspace directory.
- `session.metadata.codingAssistant.surface`: `right-sidebar`.
- `session.metadata.codingAssistant.selectedTaskID`: currently focused task, nullable.
- `session.metadata.codingAssistant.executor`: selected default executor, nullable.

Add one host-state storage table because terminal snapshots are runtime state, not conversation content:

- `tui_host_state.session_id`: primary key, references assistant session.
- `tui_host_state.project_id`: copied ownership assertion.
- `tui_host_state.directory`: normalized directory assertion.
- `tui_host_state.pty_id`: current live PTY ID, nullable.
- `tui_host_state.status`: `starting`, `attached`, `detached`, `exited`, `closed`, `errored`.
- `tui_host_state.cols`: last terminal column count.
- `tui_host_state.rows`: last terminal row count.
- `tui_host_state.buffer`: serialized terminal buffer.
- `tui_host_state.cursor`: serialized cursor data.
- `tui_host_state.scroll_y`: last scroll position.
- `tui_host_state.updated_at`: last snapshot time.

No database migration compatibility is required for this unreleased project. Reset DB and regenerate schema/tests under the new contract.

### 3.2 Ownership assertions

Every project-scoped route reachable from the TUI must assert:

- `session.projectID === Instance.project.id`
- `session.directory === Instance.directory`
- `session.metadata.codingAssistant.surface === "right-sidebar"` when the route is right-sidebar specific

This applies to:

- `/coding/session/:id`
- `/session/:id/conversation`
- `/session/:id/events`
- `/session/:id/message`
- `/session/:id/prompt_async`
- every new `/tui/host/:sessionID/*` route

The previous split where `/coding/session/:id` validates ownership but canonical `/session/:id/*` does not is not acceptable.

### 3.3 Directory normalization

Right-sidebar list/create/claim must use `Instance.directory` as the single source.

Rules:

- Do not trust raw query `directory` after middleware normalization.
- If query `directory` remains for SDK compatibility, normalize it through the same server path resolver and assert equality with `Instance.directory`.
- Session list must not create duplicates because of slash, case, symlink, or caller path differences.

### 3.4 Task binding

The side TUI is project-bound by default and task-aware when a task is selected.

The selected task is state, not a separate assistant identity:

- selecting a task updates `session.metadata.codingAssistant.selectedTaskID`;
- prompts still go through the assistant session;
- tool calls that operate on a task must carry the selected task or an explicit task ID;
- audit metadata must include the source assistant session and selected task when present.

If future product direction requires one assistant per task, this document must be revised before implementation. The current plan chooses one project assistant session with task-aware focus to avoid duplicating conversation histories across tasks.

## 4. Required Tool Capability Surface

The TUI should expose tools through one registry. The registry source should be `PanelCapabilityRegistry` or a renamed project capability registry, not a separate hard-coded right-sidebar whitelist.

Required capabilities:

- `query_project`: project ID, directory, config file, worktree, branch, provider readiness, active workspace state.
- `query_agent_team`: active agents, task sessions, statuses, current tool activity, retry/error state, executor/model assignment.
- `query_task`: board item, goal workflow, pending questions/permissions, latest protocol activity, checks.
- `view_tasks`: list task board items.
- `view_board`: show board grouped by workflow/status.
- `view_plan`: show the current task/goal plan when present.
- `select_task`: focus a task in the TUI and persist selected task.
- `select_session`: navigate to a session in the TUI.
- `create_task`: create a project task from the side TUI.
- `send_task_message`: send a message through canonical task/session APIs.
- `reply_interaction`: answer a pending agent interaction.
- `reject_interaction`: reject a pending agent interaction.
- `retry_task`: retry failed work through the canonical scheduler/task API.
- `replan_task`: request replanning through the canonical task API.
- `cancel_task`: cancel queued/running task work through the canonical task API.
- `update_checks`: update task check state.
- `update_goal`: update current goal/checkpoint state when the canonical task API supports it.
- `delete_goal`: delete a goal/checkpoint when the canonical task API supports it.
- `set_executor`: set the default executor for new tasks or selected task scope.
- `show_toast`: visible TUI feedback.
- `execute_tui_command`: dispatch a registered TUI command by ID.

Potentially visible but not automatically granted:

- `capture_overlay_screenshot`: existing implementation exists, but it must be reviewed before exposing to the side assistant because current right-sidebar capability allowlists do not include it.

Rules:

- The visible TUI command list and the callable capability list must be generated from the same registry.
- Host code can validate schemas and irreversible-operation confirmations, but must not add flow gates to teach an agent which operation path to choose.
- Browser UI state is not a tool source.
- Logs and task archives are diagnostic/export sources only. They must not become transcript or terminal recovery sources.

## 5. Lifecycle Contract

### 5.1 Open and attach

When the right sidebar opens:

1. The overlay calls `POST /tui/host/session`.
2. The server claims or creates the assistant session for current project/directory.
3. The server asserts ownership and loads `tui_host_state`.
4. If a live PTY exists for that session, attach.
5. If no live PTY exists, start the canonical OpenTUI app in a PTY.
6. The overlay renders `ghostty-web` and subscribes to host events.

### 5.2 Close and detach

When the right sidebar closes:

- detach the viewer;
- serialize and persist the terminal buffer;
- keep the PTY alive unless the user explicitly closes the TUI host;
- clear overlay event subscriptions.

### 5.3 Explicit host close

When the user closes the TUI host:

- send PTY termination;
- save final snapshot;
- mark host state `closed`;
- emit a visible lifecycle event in the stream.

### 5.4 Project switch

When project/directory changes:

- immediately detach from the old TUI host;
- clear the currently sendable assistant session in the overlay;
- claim a TUI host for the new normalized directory;
- reject any stale event/input/resize call whose session ownership does not match current `Instance`.

This directly addresses the stale-session bug found in review.

### 5.5 Server restart

After server restart:

- no process resurrection is faked;
- saved terminal buffer is restored as visual history;
- host state is marked `exited` if the old PTY no longer exists;
- the next explicit attach starts a new PTY and appends a visible lifecycle event.

### 5.6 Multi-window

Multiple viewers may subscribe to the same project-bound TUI host. Input ownership must be explicit:

- each attachment gets an `attachID`;
- events are broadcast;
- write calls carry `attachID`;
- the server records the latest active attachment for audit and conflict diagnostics.

This is a data integrity contract for terminal input, not an LLM flow gate.

## 6. Implementation Phases

### Phase 0: freeze the target and fail old UI

Edits:

- Add tests that fail if `CodingAssistantPanel` is imported from `packages/overlay/src/main.tsx`.
- Add tests that fail if `.coding-assistant-transcript` or textarea composer selectors remain.
- Add tests that fail if `@opentui/*@0.1.81` remains in `package.json` or `bun.lock`.

Do not delete files in this phase yet. The goal is to make the old path visibly invalid before migration.

### Phase 1: dependency upgrade

Edits:

- Upgrade OpenTUI dependencies.
- Add `@opentui/keymap`.
- Add PTY and terminal renderer dependencies.
- Port OpenCode PTY postinstall support only if dependency installation proves it is required.

Tests:

- dependency guard test;
- targeted TUI package import test;
- `bun install` lockfile update;
- package typecheck for TUI package.

### Phase 2: copy keymap and plugin runtime

Edits:

- Copy upstream keymap and plugin runtime modules.
- Adapt imports and state/client types.
- Export `@opencorvus-ai/plugin/tui` from local plugin package.
- Delete local keybind and dialog command modules after replacement compiles.

Tests:

- keymap registration and dispatch;
- command palette registration;
- slash command registration;
- plugin lifecycle cleanup;
- no imports from deleted local keybind modules.

### Phase 3: copy sidebar slots and feature plugins

Edits:

- Copy upstream sidebar shell.
- Copy internal sidebar feature plugins.
- Convert OpenCorvus existing sidebar blocks into plugin registrations.
- Add `agent-team` internal plugin.

Tests:

- sidebar renders through slots;
- each internal plugin can be enabled/disabled;
- agent-team plugin reads canonical project/task state;
- no hard-coded sidebar section imports remain.

### Phase 4: project/session ownership fix

Edits:

- Centralize session ownership assertion.
- Apply it to right-sidebar coding routes and canonical session routes reachable from right-sidebar.
- Normalize directory once through `Instance.directory`.
- Update session metadata schema for selected task/executor.

Tests:

- stale session from another project is rejected for conversation/events/message/prompt routes;
- Windows path variants do not create duplicate right-sidebar sessions;
- project switch clears sendable session before rebind;
- selected task metadata persists and is included in audit/tool context.

### Phase 5: embedded PTY host

Edits:

- Copy/adapt OpenCode PTY primitives.
- Add `tui_host_state` schema.
- Keep assistant conversation in `session/message/part`.
- Keep async prompt state in `a2a_task_queue`.
- Keep task and agent-team state in engine/protocol stores.
- Add `/tui/host/*` routes.
- Start canonical OpenTUI app inside PTY for the right sidebar.
- Remove right-sidebar dependence on `Tui.spawn()`.

Tests:

- create/attach/input/output/resize/close routes;
- snapshot persistence;
- PTY crash behavior;
- server restart behavior;
- no external terminal launcher on right-sidebar path.

### Phase 6: overlay host replacement

Edits:

- Copy/adapt OpenCode `ghostty-web` terminal component and terminal writer.
- Replace `CodingAssistantPanel` with `RightSidebarTuiHost`.
- Delete browser transcript service/reducer/CSS.
- Keep right-panel tab identity, but route it to the TUI host.

Tests:

- overlay mounts terminal host;
- no `CodingAssistantPanel` import remains;
- terminal receives output and accepts input;
- project switch detaches old stream and claims new host;
- visual screenshot proves nonblank TUI inside right sidebar.

### Phase 7: capability registry unification

Edits:

- Replace `RIGHT_SIDEBAR_ASSISTANT_ALLOWED_ACTIONS` with generated capability metadata from the canonical registry, or rename the registry so panel and TUI share the same source.
- Add `query_project`, `query_agent_team`, and missing task operations if absent.
- Expose registered capabilities to the TUI plugin API.

Tests:

- visible TUI commands and callable tools come from the same registry;
- all required capabilities are listed;
- forbidden actions are rejected by schema/capability metadata;
- no separate hard-coded right-sidebar whitelist remains.

### Phase 8: delete legacy route surface

Edits:

- Delete `/tui/execute-command`, `/tui/show-toast`, `/tui/select-session`, and command alias routes if they duplicate copied command registry.
- Keep only host/session routes and any explicit external TUI action that remains product-approved.
- Update OpenAPI/SDK/docs.

Tests:

- removed routes are absent from OpenAPI.
- SDK compiles with new routes.
- old command route tests are deleted or rewritten to command registry tests.
- `api:routes-check` and `docs:check` pass.

### Phase 9: visual and product acceptance

Tests:

- Open overlay with right panel.
- Select assistant/TUI tab.
- Verify OpenTUI frame renders inside the right sidebar.
- Type through terminal and observe TUI response.
- Query project state.
- Query agent team state.
- Select a task.
- Send a task message.
- Reload browser and verify terminal snapshot restore.
- Switch project and verify old session cannot receive input.
- Crash PTY and verify visible lifecycle event plus clean restart.

Visual acceptance:

- Must use screenshots or visible browser testing.
- Must include canvas or pixel checks that terminal area is nonblank.
- Must verify text and controls do not overlap at desktop and narrow right-sidebar widths.
- Must verify no external terminal window is launched for the right-sidebar path.

## 7. Test Matrix

### Unit tests

- Dependency versions.
- OpenTUI keymap command registration.
- Leader key and command slash behavior.
- Plugin slot registry.
- Internal plugin lifecycle cleanup.
- Sidebar renders slots, not hard-coded sections.
- Capability registry completeness.
- Directory normalization helper.
- Session ownership assertion helper.
- Terminal snapshot serialization and deserialization.

### Server integration tests

- `POST /tui/host/session` creates or claims a host.
- `GET /tui/host/:sessionID/events` streams output and lifecycle events.
- `POST /tui/host/:sessionID/input` writes to PTY.
- `POST /tui/host/:sessionID/resize` resizes PTY and persists dimensions.
- `POST /tui/host/:sessionID/close` kills PTY and marks state closed.
- `/session/:id/conversation` rejects wrong project/directory for right-sidebar sessions.
- `/session/:id/events` rejects wrong project/directory for right-sidebar sessions.
- `/session/:id/message` rejects wrong project/directory for right-sidebar sessions.
- `/session/:id/prompt_async` rejects wrong project/directory for right-sidebar sessions.
- `/coding/sessions` does not duplicate sessions for equivalent directory strings.

### Overlay tests

- Assistant tab mounts `RightSidebarTuiHost`.
- `CodingAssistantPanel` is not imported.
- Transcript reducer service is absent.
- Terminal service uses typed host routes.
- Project switch detaches old stream before claiming new host.
- Reload restores saved terminal snapshot.

### End-to-end tests

- Right sidebar TUI starts in current project.
- Terminal renders nonblank content.
- Keyboard input reaches TUI.
- TUI command palette opens through copied keymap.
- Agent-team plugin shows project tasks.
- Selecting a task changes persisted selected task.
- Task message is sent through canonical APIs.
- Server restart restores terminal snapshot and starts new PTY only on explicit attach.
- Stale session from old project cannot receive prompt/input.

### Build and repository checks

- targeted package tests for `packages/opencorvus`;
- targeted overlay tests;
- OpenAPI route check;
- SDK generation/check if route schemas changed;
- docs check;
- typecheck;
- pre-push hooks without bypass.

## 8. Delete List

Delete after replacement tests are in place:

- `packages/overlay/src/components/CodingAssistantPanel.tsx`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/overlay/src/services/coding-assistant-transcript.ts`
- old `.coding-assistant-*` CSS selectors
- `packages/overlay/test/coding-assistant-panel.test.ts`
- `packages/opencorvus/src/cli/cmd/tui/context/keybind.tsx`
- `packages/opencorvus/src/util/keybind.ts`
- `packages/opencorvus/src/cli/cmd/tui/component/dialog-command.tsx`
- `packages/opencorvus/src/tui/command.ts`
- route tests for deleted `/tui/*` command aliases

Keep only if explicitly separated from right-sidebar TUI:

- external terminal launch action for users who ask to open a standalone TUI.

## 9. Completion Criteria

This migration is complete only when all of the following are true:

- `rg "CodingAssistantPanel|coding-assistant-transcript|coding-assistant-transcript"` returns no source imports or selectors.
- `rg "@opentui/(core|solid).*0.1.81|@opentui/keymap"` proves OpenTUI dependency state is upgraded and keymap is present.
- The right sidebar renders a `ghostty-web` terminal connected to a server PTY running canonical OpenTUI.
- The copied keymap, plugin runtime, slots, and internal plugins are in the OpenCorvus TUI tree.
- Project/session ownership tests reject stale-session cross-project calls.
- Agent-team capabilities are exposed through one registry and visible in the TUI.
- Legacy command routes and local keybind systems are gone.
- Unit, integration, OpenAPI/docs, typecheck, and visual E2E checks pass.
- The final commit history shows the migration phases and no hook was bypassed.

## 10. Implementation Round Log

### 2026-06-05 Round 1: dependency substrate

Implemented:

- Upgraded OpenTUI substrate to the OpenCode baseline: `@opentui/core@0.3.1`, `@opentui/solid@0.3.1`, `@opentui/keymap@0.3.1`.
- Added `@lydell/node-pty@1.2.0-beta.12` and `ghostty-web`.
- Added dependency guards in `packages/opencorvus/test/tui/dependency-guard.test.ts`.
- Adapted existing TUI code to OpenTUI `0.3.1` API changes: removed obsolete `disableStdoutInterception()` and switched paste decoding to `decodePasteBytes(event.bytes)`.

Verified:

- `bun test test/tui` from `packages/opencorvus`
- `bun run typecheck` from `packages/opencorvus`
- `bun run --cwd packages/overlay typecheck`
- pre-push hook passed when commit `306629ac9` was pushed.

OpenCode gap after the round:

- The project had the right dependency floor, but the TUI still used the local `KeybindProvider`, local `dialog-command`, hard-coded sidebar sections, and external terminal runtime.

### 2026-06-05 Round 2: copied keymap and command substrate

Implemented:

- Copied OpenCode-derived keymap substrate into `packages/opencorvus/src/cli/cmd/tui/keymap.ts`.
- Copied OpenCode-derived TUI keybind definitions into `packages/opencorvus/src/cli/cmd/tui/config/keybind.ts`.
- Moved `TuiConfig.get()` to resolve keybinds into the OpenTUI `BindingLookup`; no parallel local keybind parser remains.
- Copied OpenCode-derived `dialog-select`, `dialog-help`, `command-palette`, and scroll acceleration primitives.
- Replaced local `KeybindProvider`, `CommandProvider`, `dialog-command`, `context/keybind`, `util/keybind`, and `textarea-keybindings` with OpenTUI `@opentui/keymap` provider, command registry, command palette, and target-scoped bindings.
- Migrated prompt, autocomplete, home, app, session, question, permission, and session header command/key flows to the keymap registry while preserving prompt submit/paste, permission decisions, question answers, and subagent-session navigation behavior.
- Added `packages/opencorvus/test/tui/keymap-substrate.test.ts` to prove legacy TUI keybind config now resolves into the OpenTUI keymap substrate.
- Added `packages/opencorvus/test/tui/keymap-migration-guard.test.ts` to prove deleted local keybind/command sources stay deleted and critical agent workflow command bindings remain in the OpenTUI lookup.

Verified:

- `bun test test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/config/tui.test.ts` from `packages/opencorvus`
- `bun run typecheck` from `packages/opencorvus`

OpenCode comparison after the round:

- Compared against OpenCode dev commit `94c49b20ba207a92e4150c552d616930b6560e39` from 2026-06-04.
- Matched: OpenTUI `0.3.1`, `@opentui/keymap`, leader handling, command palette, dialog select action bindings, command slashes, prompt/autocomplete keymap modes, question/permission keymap interactions.
- Preserved OpenCorvus-specific agent workflow behavior: prompt image paste, prompt stash, session transcript export, permission tool labeling, question replies, and subagent task navigation.

OpenCode gap after the round:

- `packages/opencorvus/src/cli/cmd/tui/plugin/*` and `feature-plugins/*` have not been copied yet.
- The right-sidebar target still lacks OpenCode-like plugin slots for project-bound Context, MCP, LSP, Todo, and Agent Team controls.
- The embedded terminal/PTY path still needs the `ghostty-web`/real PTY host adapter work.
- No visual E2E has yet proven the screenshot-level layout: main transcript/diff area plus fixed right sidebar with project status panes.

Next required tests:

- Plugin runtime/slot tests once OpenCode TUI plugin modules are copied.
- Browser/right-sidebar visual E2E for the screenshot-level layout.
- Agent workflow regression tests for prompt submit, permission reply, question reply, and subagent-session navigation once the TUI can be mounted under the right sidebar host.

### 2026-06-05 Round 3: overlay side activity shell and project-bound TUI entry

Implemented:

- Replaced the old overlay right horizontal tab entry with a shared `SideActivityToolbar` mounted on both side panes.
- Moved task list, file explorer, and file changes into left side activities: `tasks`, `explorer`, `changes`.
- Made the right side default to the project-bound TUI activity, with right activities `tui`, `browser`, and `inspector`.
- Replaced the old right-side browser assistant mount with `TuiRuntimePanel`, which reads the canonical server route `tui/runtime/status` instead of using the deleted hand-written browser assistant transport.
- Renamed the file changes surface to `FileChangesPanel` and removed active source/test references to `RightFilesPanel`, `RightPanelTabs`, `rightPanelTab`, and `solidRightPanelTabs`.
- Added `packages/overlay/src/styles/surfaces/activity.css` as the single CSS source for side activity chrome and the TUI runtime status panel.
- Added static i18n keys for activity rails and the TUI runtime status panel.

Verified:

- `bun run --cwd packages/overlay typecheck`
- `bun test test/coding-assistant-panel.test.ts test/browser-preview-panel.test.ts test/file-explorer-editor.test.ts test/acceptance-panel-mount.test.ts` from `packages/overlay`
- `bun run --cwd packages/overlay check:i18n`

Independent review findings incorporated:

- Reviewer 1 confirmed the half-migrated overlay shell originally broke `RightPanelTabs`/`RightFilesPanel` imports and JSX; this round fixed the compile break, replaced old tests, and made the activity shell a single mounted state source.
- Reviewer 2 compared latest OpenCode dev commit `94c49b20ba207a92e4150c552d616930b6560e39` and identified the real next gap: OpenCode plugin runtime, slots, internal sidebar plugins, and diff-viewer plugins are still missing.
- Reviewer 3 confirmed the project-bound side TUI tool surface should read task state from existing `EngineRoutes`/`EngineService`, operate through `PanelTool` and `/panel/message/stream`, and avoid duplicating overlay services or `/tui/runtime/proxy` as a task API.

OpenCode gap after the round:

- This is only the overlay side activity shell and a canonical runtime-status entry. It does not yet render the screenshot-level OpenCode TUI.
- The right TUI activity does not yet host `ghostty-web`, server PTY output, keyboard input, or OpenTUI pixels inside the overlay.
- The OpenCode plugin runtime/slot model is still absent from `packages/opencorvus/src/cli/cmd/tui/plugin/*`.
- Context, MCP, LSP, Todo, Modified Files, and Agent Team panes are not yet copied from OpenCode feature plugins.
- The current `TuiRuntimePanel` is intentionally not a replacement for the terminal viewport; completion still requires the PTY/terminal host adapter and visual E2E.
