# Right Sidebar OpenCode TUI Copy Implementation Plan

Date: 2026-06-04
Reviewed again: 2026-06-05
Status: staged implementation log and remaining plan; implementation is in progress
Upstream baseline: `anomalyco/opencode` local snapshot `730ea6d2e3eedc5f3a5b4151cdaabd2d744fd828`
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
- Current inspected commit: `730ea6d2e3eedc5f3a5b4151cdaabd2d744fd828`
- New commits: `7f54b1b fix build`, `9f3a0fe chore: update nix node_modules hashes`, `94c49b2 make scripts executable`, `730ea6d fix(opencode): attribute task child agent on creation (#30786)`
- Checked paths: `packages/opencode/src/cli/cmd/tui`, `packages/app/src`, `packages/core/src/pty`, `packages/plugin`, root/package package manifests
- Latest delta from `94c49b20ba207a92e4150c552d616930b6560e39` to `730ea6d2e3eedc5f3a5b4151cdaabd2d744fd828`: only `packages/opencode/src/cli/cmd/tui/app.tsx` changed in the watched TUI/plugin/PTY/app path set.
- Result: no changes in OpenCode terminal host, PTY, plugin TUI API, plugin runtime, slot registry, feature plugins, or OpenTUI dependency versions since the prior inspected snapshot.

The copy plan remains valid against the current upstream snapshot. The baseline hash above is updated so implementation must copy from `730ea6d2e3eedc5f3a5b4151cdaabd2d744fd828`, not the older `94c49b20ba207a92e4150c552d616930b6560e39`.

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

### 2026-06-05 Round 4: copied TUI plugin API, slot host, and internal runtime entry

Implemented:

- Refreshed OpenCode dev to `730ea6d2e3eedc5f3a5b4151cdaabd2d744fd828` before editing. Watched TUI/plugin/PTY/app paths changed only in upstream `packages/opencode/src/cli/cmd/tui/app.tsx`; plugin API/runtime/slots and sidebar feature plugins were unchanged from the prior baseline.
- Added `@opencorvus-ai/plugin/tui` as the single exported TUI plugin API surface, copied from OpenCode `packages/plugin/src/tui.ts` and adapted to OpenCorvus SDK type names.
- Copied OpenCode-derived TUI plugin host modules into `packages/opencorvus/src/cli/cmd/tui/plugin/*`:
  - `api.tsx`
  - `runtime.ts`
  - `slots.tsx`
  - `command-shim.ts`
  - `internal.ts`
- Extended the TUI route model with `type: "plugin"` so plugin routes use a runtime route map instead of hard-coded component branches.
- Wired `App` to create the TUI plugin API, initialize `TuiPluginRuntime`, dispose runtime on cleanup, render plugin routes, and mount OpenCode host slots `app` and `app_bottom`.
- Extended local TUI dialogs to accept OpenCode's `xlarge` dialog size.
- Added `packages/opencorvus/test/tui/plugin-runtime-guard.test.ts` for the TUI plugin export, v1 command shim dispatch/bindings, runtime/slot wiring, and plugin route guard.

Verified:

- `bun install`
- `bun run --cwd packages/plugin typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test test/tui/plugin-runtime-guard.test.ts test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/tui/dependency-guard.test.ts` from `packages/opencorvus`

OpenCode comparison after the round:

- Matched: public `@opencorvus-ai/plugin/tui` API shape, `createBindingLookup`, legacy `api.command` shim, host slot registry built with `createSolidSlotRegistry`/`createSlot`, scoped keymap cleanup, plugin lifecycle dispose stack, plugin route registration, and app-level slot mount points.
- Preserved OpenCorvus-specific agent workflow behavior: existing app commands, prompt submit/paste, permission/question handling, session navigation, and subagent child/parent command bindings still route through the existing command registry and tested keymap lookup.

OpenCode gap after the round:

- External TUI plugin loading/install is not implemented yet because OpenCode's `runtime.ts` depends on its `plugin/shared`, `plugin/loader`, `plugin/meta`, and `plugin/install` modules, which do not yet exist in OpenCorvus. This must be copied as a grouped loader round, not replaced with a local fake installer.
- `internal.ts` is intentionally the single internal plugin registry but is still empty. Context, MCP, LSP, Todo, Files, Footer, WhichKey, DiffViewer, and Agent Team feature plugins still need to be copied and registered there.
- Sidebar shell still has hard-coded local content. The next OpenCode-aligned round must replace `routes/session/sidebar.tsx` with slot rendering and move panes into copied feature plugins.
- The right overlay activity still shows runtime status, not a `ghostty-web` terminal connected to server PTY output.

### 2026-06-05 Round 5: copied sidebar feature plugins and slot-based sidebar shell

Implemented:

- Copied OpenCode sidebar feature plugin boundaries into `packages/opencorvus/src/cli/cmd/tui/feature-plugins/sidebar/*`:
  - `context.tsx`
  - `mcp.tsx`
  - `lsp.tsx`
  - `todo.tsx`
  - `files.tsx`
  - `footer.tsx`
- Replaced the hard-coded session sidebar with the OpenCode slot shell: `sidebar_title`, `sidebar_content`, and `sidebar_footer`.
- Registered the copied sidebar plugins through the single `internalTuiPlugins()` registry.
- Kept OpenCorvus-specific behavior where required:
  - Context cost is still derived from assistant messages because OpenCorvus local session state does not expose OpenCode's `session.cost` field.
  - File truncation uses existing `Locale.truncateMiddle`; no new truncation helper was hand-written.
  - Footer branding says OpenCorvus and reads version from `Installation.VERSION`.
- Extended `plugin-runtime-guard.test.ts` to assert the sidebar shell uses slots and no longer imports/contains direct MCP, LSP, Todo, file diff, or session diff rendering logic.

Verified:

- `bun run --cwd packages/opencorvus typecheck`
- `bun test test/tui/plugin-runtime-guard.test.ts test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/tui/dependency-guard.test.ts` from `packages/opencorvus`

OpenCode comparison after the round:

- Matched: slot-based session sidebar shell, `sidebar_title`, `sidebar_content`, `sidebar_footer`, copied Context/MCP/LSP/Todo/Files/Footer internal plugin architecture, and internal plugin registry ownership.
- Removed: local monolithic sidebar rendering for Context, MCP, LSP, Todo, Modified Files, Getting Started, directory, and version footer.

OpenCode gap after the round:

- System feature plugins remain missing: WhichKey, PluginManager, DiffViewer, Notifications, SessionV2Debug, and session switcher.
- Home feature plugins remain missing: HomeFooter and HomeTips.
- The Agent Team project-bound plugin required by OpenCorvus does not exist yet.
- External TUI plugin loader/install remains missing.
- The overlay right activity still lacks the embedded `ghostty-web` terminal and server PTY host.

### 2026-06-05 Round 6: copied system plugins for which-key, plugin manager, and notifications

Implemented:

- Copied OpenCode system feature plugins into `packages/opencorvus/src/cli/cmd/tui/feature-plugins/system/*`:
  - `which-key.tsx`
  - `plugins.tsx`
  - `notifications.ts`
- Registered these plugins through the single `internalTuiPlugins()` registry.
- Kept OpenCode's `which-key` default disabled state so the plugin manager can activate it, matching upstream behavior.
- Adapted Notifications to OpenCorvus SDK session status names:
  - `streaming` and `retry` mark the session active.
  - `idle` and `terminal` complete an active session.
- Kept PluginManager wired to runtime `plugins.list/activate/deactivate/add/install` rather than creating a separate local plugin menu.
- Extended `plugin-runtime-guard.test.ts` to assert:
  - system plugins are registered from the internal registry;
  - WhichKey uses `app` and `app_bottom` slots;
  - PluginManager operates through the runtime plugin API;
  - Notifications listens to question, permission, and session-status events.

Verified:

- `bun run --cwd packages/opencorvus typecheck`
- `bun test test/tui/plugin-runtime-guard.test.ts test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/tui/dependency-guard.test.ts` from `packages/opencorvus`

OpenCode comparison after the round:

- Matched: WhichKey command names, layout/pending-preview persistence keys, slot placement, PluginManager command registrations, plugin list/activate/deactivate wiring, and notification event coverage for question, permission, session done, and session error.
- Preserved OpenCorvus-specific agent workflow behavior by adapting only status enum names and leaving existing prompt/session/permission/question routes untouched.

OpenCode gap after the round:

- DiffViewer and its file-tree helper modules remain missing.
- SessionV2Debug and session switcher remain missing.
- HomeFooter/HomeTips are still hard-coded in local `routes/home.tsx`; home slots exist in the plugin API but are not yet mounted by the route.
- External TUI plugin loader/install remains missing.
- Agent Team project-bound plugin and right-sidebar PTY/`ghostty-web` host remain missing.

### 2026-06-05 Round 7: copied home footer/tips plugins and slot-based home shell

Implemented:

- Replaced local `routes/home.tsx` hard-coded logo/prompt/tips/footer layout with the OpenCode-style slot shell:
  - `home_logo`
  - `home_prompt`
  - `home_bottom`
  - `home_footer`
- Copied OpenCode home feature plugins into `packages/opencorvus/src/cli/cmd/tui/feature-plugins/home/*`:
  - `footer.tsx`
  - `tips.tsx`
  - `tips-view.tsx`
- Registered `HomeFooter` and `HomeTips` through `internalTuiPlugins()`.
- Deleted the old local `packages/opencorvus/src/cli/cmd/tui/component/tips.tsx` to avoid a second tips implementation.
- Preserved OpenCorvus-specific prompt workflow:
  - `route.initialPrompt` still populates the prompt.
  - `--prompt` waits for sync/model readiness before submit, matching the upstream OpenCode readiness pattern.
  - existing `Prompt` props are preserved until the OpenCode prompt prop surface is copied in a later round.
- Adapted tips/footer branding and paths from OpenCode to OpenCorvus.

Verified:

- `bun run --cwd packages/opencorvus typecheck`
- `bun test test/tui/plugin-runtime-guard.test.ts test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/tui/dependency-guard.test.ts` from `packages/opencorvus`

OpenCode comparison after the round:

- Matched: home route slot boundaries, HomeFooter plugin, HomeTips plugin, dynamic shortcut-aware tips, and removal of hard-coded home footer/tips rendering.
- Preserved: existing OpenCorvus prompt submit path and route initialPrompt behavior.

OpenCode gap after the round:

- `home_prompt_right` is in the public slot API but not yet fully useful because the local `Prompt` component does not expose OpenCode's `right` and `placeholders` props.
- DiffViewer and SessionV2Debug remain missing.
- External TUI plugin loader/install remains missing.
- Agent Team project-bound plugin and right-sidebar PTY/`ghostty-web` host remain missing.

### 2026-06-05 Round 8: copied DiffViewer and added OpenCode-style VCS diff source

Implemented:

- Refreshed OpenCode dev to `730ea6d2e3eedc5f3a5b4151cdaabd2d744fd828` before editing. This round copied from the latest upstream baseline rather than the older half-year-old local TUI.
- Copied OpenCode DiffViewer feature plugin modules into `packages/opencorvus/src/cli/cmd/tui/feature-plugins/system/*`:
  - `diff-viewer.tsx`
  - `diff-viewer-ui.tsx`
  - `diff-viewer-file-tree.tsx`
  - `diff-viewer-file-tree-utils.ts`
- Registered `DiffViewer` through the single `internalTuiPlugins()` registry.
- Copied OpenCode diff keybind names and command routing into the TUI keymap single source:
  - `diff_close`
  - `diff_toggle`
  - `diff_expand`
  - `diff_expand_all`
  - `diff_collapse`
  - `diff_switch_focus`
  - `diff_next_file`
  - `diff_previous_file`
  - `diff_toggle_file_tree`
  - `diff_single_patch`
  - `diff_switch_source`
  - `diff_toggle_view`
  - `diff_help`
- Added OpenCode-style `Vcs.diff(mode, options)` as the canonical source for working-tree and branch patches, using existing OpenCorvus git/project infrastructure instead of creating a TUI-only diff path.
- Added `GET /vcs/diff`, regenerated the SDK OpenAPI artifacts, and wired `client.vcs.diff` into the copied DiffViewer.
- Extended `@opencorvus-ai/plugin/tui` state types so `session.diff` exposes patch/status data compatible with the copied DiffViewer.
- Adapted session diff data in the TUI plugin API by deriving patches from `before`/`after` snapshots with the mature `diff` package, not local string patch construction.

Codex/agent review feedback applied:

- DiffViewer reviewer confirmed the copied plugin needs a real SDK `vcs.diff` route, OpenCode diff keybinds, internal registry registration, and file-tree utility tests. This round added those items.
- DiffViewer reviewer also confirmed local `session_panel` is not an upstream DiffViewer dependency. It remains outside this copy round and must not become a fake replacement for OpenCode DiffViewer.
- Project-bound tool reviewer confirmed the side TUI must keep using existing coding/session workflow APIs and `PanelTool`/`EngineService` paths for agent-team operations. This round only added VCS diff capability; it did not introduce a new task/session store or `/tui/runtime/submit-task` workflow.

Verified:

- `bun run --cwd packages/plugin typecheck`
- `bun run --cwd packages/sdk/js typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test test/tui/diff-viewer-file-tree-utils.test.ts test/tui/plugin-runtime-guard.test.ts test/project/vcs.test.ts test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/tui/dependency-guard.test.ts` from `packages/opencorvus`

OpenCode comparison after the round:

- Matched: DiffViewer plugin registration, route path, help dialog shape, focus modes, source switching between working tree and session diff, unified/split view toggle, file-tree sorting and navigation helpers, diff keybind command names, and `vcs.diff` SDK usage.
- Preserved OpenCorvus-specific workflow behavior: no prompt/session/permission/question route was replaced; VCS diff is a project tool capability and the existing agent workflow remains the only task/session execution source.

OpenCode gap after the round:

- External TUI plugin loader/install still needs the grouped OpenCode plugin loader/meta/install copy. The current plugin manager can call the runtime API, but external loading is still inactive until those upstream modules exist in OpenCorvus.
- Agent Team project-bound plugin is still missing. It must expose project task/session status and operations through existing `/coding/session*`, `/session/:id/prompt_async`, `/session/events`, and `PanelTool`/`EngineService` capabilities, not a new TUI workflow API.
- The right sidebar activity still lacks the embedded `ghostty-web` terminal host and server PTY bridge, so the browser overlay is not yet screenshot-level interactive OpenCode output.
- `home_prompt_right` remains only partially useful until the local Prompt component adopts OpenCode's richer `right` and `placeholders` prop surface.
- SessionV2Debug and session switcher remain missing.
- Visual/runtime verification of the actual right-side TUI remains blocked until the terminal host bridge is implemented; current tests cover code ownership, API wiring, and copied DiffViewer behavior.

### 2026-06-05 Round 9: copied Prompt slot surface and latest OpenCode prompt sizing

Implemented:

- Refreshed OpenCode dev to `cc9b73b0bddb54dfce534b4db9684c1959d81ba6` before editing. The new upstream baseline added session-moving control-plane work and changed TUI Prompt/home/session prompt wiring.
- Adopted the OpenCode Prompt public surface in the local host Prompt:
  - `right?: JSX.Element`
  - `placeholders?: { normal?: string[]; shell?: string[] }`
  - `showPlaceholder === false`
  - dynamic `tuiConfig.prompt?.max_height` fallback to terminal-height-based max height
- Removed Prompt-internal placeholder constants. Home now owns the OpenCode default placeholder list and passes it through `placeholders={placeholder}`.
- Mounted `home_prompt_right` inside the actual Prompt meta row instead of leaving the public slot API disconnected from the host prompt.
- Mounted `session_prompt` and `session_prompt_right` around the existing session Prompt, matching OpenCode's host slot boundary while preserving the existing OpenCorvus submit, permission, question, and route behavior.
- Added OpenCode's prompt size config schema:
  - `prompt.max_height`
  - `prompt.max_width`
- Added home prompt max-width behavior matching OpenCode:
  - numeric width caps the home prompt;
  - `"auto"` scales to 70% terminal width with a 75-column minimum.
- Removed the local plugin Prompt part double-source by changing `@opencorvus-ai/plugin/tui` `TuiPromptInfo.parts` to reuse SDK `FilePart`, `AgentPart`, and `TextPart` shapes. Host Prompt refs and plugin Prompt refs now typecheck without a slot-boundary cast.

Verified:

- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun test test/tui/plugin-runtime-guard.test.ts test/config/tui.test.ts test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/tui/dependency-guard.test.ts` from `packages/opencorvus`

OpenCode comparison after the round:

- Matched: `home_prompt_right`, `session_prompt`, and `session_prompt_right` host slot placement; Prompt `right/placeholders/showPlaceholder` prop surface; prompt max-height and home max-width config names; home default placeholder ownership.
- Preserved OpenCorvus-specific agent workflow behavior: prompt submit still calls the existing OpenCorvus `session.prompt/session.command/session.shell` client paths; permission and question prompts still block the session prompt through existing local predicates; no OpenCode `moveSession` or project-copy control-plane API was faked.

OpenCode gap after the round:

- Latest OpenCode added `dialog-move-session.tsx`, `prompt/move.tsx`, `prompt/workspace.tsx`, `routes/home/session-destination.tsx`, and control-plane/project-copy APIs. OpenCorvus does not yet have the same canonical project-copy/control-plane source, so these were not copied in this round. They must be ported as a real workflow/API round, not approximated in the Prompt component.
- External TUI plugin loader/install, Agent Team project-bound plugin, SessionV2Debug/session switcher, and the right-sidebar `ghostty-web`/PTY bridge remain missing.
- Visual/runtime verification of the screenshot-level right-side TUI still depends on the terminal host bridge.

### 2026-06-05 Round 10: copied session switcher plugin and pinned quick-slot state

Implemented:

- Continued from OpenCode dev `cc9b73b0bddb54dfce534b4db9684c1959d81ba6`.
- Copied OpenCode session switcher feature plugin modules into `packages/opencorvus/src/cli/cmd/tui/feature-plugins/session/*`:
  - `index.tsx`
  - `dialog.tsx`
  - `preview-pane.tsx`
  - `util.tsx`
- Registered `SessionSwitcher` through the single `internalTuiPlugins()` registry.
- Removed the old local `component/dialog-session-list.tsx` and removed `session.list` command ownership from `app.tsx`, so the session list now has one implementation source.
- Copied OpenCode local session pinned/slot state into `context/local.tsx`:
  - persistent `session.json`
  - `pinned()`
  - `slots()`
  - `isPinned()`
  - `togglePin()`
  - `quickSwitch(slot)`
  - prune on `session.deleted`
- Added the missing `session_quick_switch_1` through `session_quick_switch_9` command map entries so existing keybind definitions resolve to commands.
- Added OpenCode quick-switch command registrations in `app.tsx` so pinned quick slots are executable.
- Adapted the copied dialog to OpenCorvus canonical session APIs:
  - search uses existing `sdk.client.session.list({ search, limit })`;
  - preview uses existing `sdk.client.session.messages`;
  - session status maps `streaming`/`retry` instead of OpenCode's `busy`/`retry`;
  - delete uses existing `sdk.client.session.delete`.

Verified:

- `bun run --cwd packages/opencorvus typecheck`
- `bun test test/tui/plugin-runtime-guard.test.ts test/tui/session-switcher-util.test.ts test/tui/keymap-substrate.test.ts test/tui/keymap-migration-guard.test.ts test/tui/dependency-guard.test.ts` from `packages/opencorvus`

OpenCode comparison after the round:

- Matched: internal `session.list` plugin ownership, pinned session category, quick slot numbering, quick switch command names, preview pane with latest exchange summary, debounced search, rename/delete/pin actions, and removal of app-level hard-coded session list dialog.
- Preserved OpenCorvus-specific agent workflow behavior: app-level `session.new`, session route prompt, permissions/questions, and session prompt submission paths are unchanged.

OpenCode gap after the round:

- OpenCode's workspace recovery path in session delete depends on its workspace/project-copy control plane. OpenCorvus has no equivalent single source in the TUI yet, so this round intentionally kept delete on the existing canonical `session.delete` API instead of faking workspace restore/delete.
- `SessionV2Debug` remains missing because OpenCode's module depends on `sync-v2` and v2 message schema that are not present as canonical OpenCorvus TUI data sources.
- External TUI plugin loader/install, Agent Team project-bound plugin, latest move-session/workspace prompt flow, and the right-sidebar `ghostty-web`/PTY bridge remain missing.
- Visual/runtime verification of the screenshot-level right-side TUI still depends on the terminal host bridge.

### 2026-06-05 Round 11: added project-bound embedded TUI PTY host API

Implemented:

- Rechecked OpenCode dev before editing; local upstream remained at `cc9b73b0bddb54dfce534b4db9684c1959d81ba6`.
- Refactored `Tui.spawn()` command construction into `Tui.resolveEmbeddedCommand()` so external terminal launch and embedded right-sidebar launch share one canonical TUI command source.
- Added `packages/opencorvus/src/tui/host.ts`:
  - starts the canonical OpenCorvus OpenTUI app inside a project-bound Pseudo Terminal (PTY);
  - captures bounded terminal output for snapshot/recovery;
  - supports input, resize, stop, status, and snapshot;
  - uses the existing packaged Node runtime plus `@lydell/node-pty` on Windows because Bun can read but cannot reliably write to the Windows PTY process.
- Added `/tui/host/*` routes:
  - `POST /tui/host/start`
  - `GET /tui/host/status`
  - `GET /tui/host/snapshot`
  - `POST /tui/host/input`
  - `POST /tui/host/resize`
  - `POST /tui/host/stop`
- Updated SDK OpenAPI and generated API docs for the new host routes.
- Added `@lydell/node-pty` to packaged runtime external/native module handling so the embedded host is available outside the development workspace.

Verified:

- `bun test packages/opencorvus/test/tui/host.test.ts`
- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts`
- `bun test --timeout 30000 packages/opencorvus/test/script/build-artifact.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- Matched the OpenCode architectural requirement that the browser-side terminal surface must be backed by a real server-owned PTY, not a hand-written chat/status panel.
- Preserved OpenCorvus-specific agent workflow behavior: the host launches the canonical TUI process and does not alter `SessionPrompt`, task queue, permission, question, or existing `/tui/runtime/*` control paths.
- Used the existing OpenCorvus runtime package resolver for native PTY dependencies instead of statically bundling native modules into the overlay-server artifact.

OpenCode gap after the round:

- OpenCode has a richer multi-session `/pty` API with list/create/get/update/remove/connect-token/connect WebSocket. This round intentionally added the narrower right-sidebar host surface required for one embedded coding assistant TUI; websocket streaming and tokenized attach still need to be copied/adapted before the overlay renderer can be live-stream rather than snapshot/poll driven.
- The overlay still renders `TuiRuntimePanel`; `ghostty-web` is not yet mounted in the right sidebar, so screenshot-level parity is still incomplete.
- External TUI plugin loader/install, Agent Team project-bound plugin, latest move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 12: replaced right-sidebar placeholder with ghostty-backed host renderer

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream advanced to `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`, but the new diff only touched dependency/build metadata (`package.json`, `bun.lock`, `bunfig.toml`, Nix hashes, and build scripts). No TUI, terminal, PTY, or app component source changed in that upstream delta.
- Deleted the old overlay runtime placeholder:
  - `packages/overlay/src/components/TuiRuntimePanel.tsx`
  - `packages/overlay/src/services/tui-runtime.ts`
- Added `packages/overlay/src/services/tui-host.ts` as the single browser client for the real host routes:
  - `tui/host/start`
  - `tui/host/status`
  - `tui/host/snapshot`
  - `tui/host/input`
  - `tui/host/resize`
  - `tui/host/stop`
- Added `packages/overlay/src/components/TuiHostPanel.tsx`:
  - dynamically loads `ghostty-web`;
  - creates a real `Terminal` and `FitAddon`;
  - starts the project-bound host only when the TUI activity is active;
  - renders host snapshots into the terminal buffer;
  - forwards terminal input to `tui/host/input`;
  - forwards terminal resize events to `tui/host/resize`;
  - observes container resize with `ResizeObserver` so the embedded terminal follows right-sidebar resizing;
  - supports explicit refresh and restart through the host API.
- Replaced the right-sidebar mount with `<TuiHostPanel active={() => rightActivity() === "tui"} />`.
- Renamed the DOM mount from `solidTuiRuntimeMount` to `solidTuiHostMount` so the new implementation does not keep the old runtime placeholder name.
- Updated TUI host labels in both locale files and synchronized the panel revision hash.
- Updated right-sidebar CSS from `.tui-runtime-*` placeholder rules to `.tui-host-*` terminal surface rules.

Verified:

- `bun test packages/overlay/test/tui-host-service.test.ts packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- Residual source grep: no `TuiRuntimePanel`, `tui-runtime`, `loadTuiRuntimeStatus`, `tui.runtime_*`, `embedded_host_pending`, or `solidTuiRuntimeMount` references remain in `packages/overlay/src`; remaining matches in `packages/overlay/test` are negative assertions proving the old path is absent.

Visual verification status:

- Vite started at `http://127.0.0.1:5187/`.
- The Codex in-app Browser attach timed out twice while trying to inspect the local page.
- Playwright had the package installed but no bundled Chromium executable. `bunx playwright install chromium` timed out after 10 minutes, and launching the system Chrome executable through Playwright also timed out before browser startup completed.
- Because of that toolchain failure, this round does not claim screenshot-level visual acceptance. The implementation is build-verified and DOM-wiring-tested, but final acceptance still needs a browser screenshot/canvas-pixel pass once the browser automation toolchain is repaired.

OpenCode comparison after the round:

- Matched the important OpenCode terminal principle for the right sidebar: the visible assistant surface is now a real terminal renderer (`ghostty-web`) backed by a server-owned PTY host route set, not a hand-written browser chat/status panel.
- Matched OpenCode's resize expectation by using the terminal fit addon and propagating resize events back to the host.
- Preserved OpenCorvus-specific agent workflow behavior: this round only changed the overlay-side right activity body and its client calls. It did not alter orchestrator, task queue, session prompt, permission/question handling, existing agent message flow, or `/tui/runtime/*` control-plane behavior.

OpenCode gap after the round:

- OpenCode still has a richer `/pty` model with list/create/get/update/remove/connect-token/connect WebSocket. The current overlay uses `snapshot` polling every 500 ms, so it is not yet equivalent to OpenCode's streaming attach model.
- Multi-PTY session list/attach, connect-token security, terminal close/remove semantics, and direct WebSocket input/output still need to be copied/adapted before the embedded TUI reaches full OpenCode parity.
- The overlay terminal surface now exists, but the project-bound Agent Team tool/plugin surface is still missing. The next implementation round must expose project task query/control and agent-team operation tools through a canonical plugin/tool API rather than a parallel browser-only API.
- External TUI plugin loader/install, latest move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

Independent review feedback to carry into the next round:

- Overlay UI double-source is removed, but server `/tui/runtime/*` still exists as the external/runtime control plane. The next OpenCode PTY migration must either replace it with the canonical PTY attach model or prove why it remains a separate non-sidebar control surface; it must not become a fallback path for the right-sidebar TUI.
- `packages/overlay/src/services/coding-assistant.ts` and `packages/overlay/src/services/coding-assistant-transcript.ts` are no longer used by the mounted right-sidebar UI, but still have old tests. They should be deleted in a dedicated cleanup round after verifying the canonical `/coding/session*` server metadata/provenance path remains covered for agent workflow.
- Add route-level host tests for successful `/tui/host/start`, `/tui/host/input`, `/tui/host/resize`, `/tui/host/stop`, plus empty input and stopped-host errors.
- Add component behavior tests with mocked `ghostty-web`: active=false does not start, active=true starts, snapshot writes to the terminal, non-prefix snapshot resets the terminal, terminal input reaches `tui/host/input`, resize de-duplicates and reaches `tui/host/resize`.
- Add browser visual acceptance after repairing browser automation: right TUI active by default, ghostty canvas visible, no `.tui-runtime-panel`, host error/connected state visible, and no overlap with right toolbar or editor.

### 2026-06-05 Round 13: closed route/test gaps and removed overlay browser-assistant double source

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 12.
- Added route-level behavior coverage for the embedded host:
  - invalid resize payload remains a 400 validation error;
  - empty input remains a 400 validation error;
  - stopped-host input and resize now return 400 through the host route contract instead of falling through as a default 500;
  - route input reaches the real Pseudo Terminal (PTY);
  - route resize updates `cols` and `rows`;
  - route snapshot returns the terminal buffer;
  - route stop tears down the host.
- Mapped `TUI host is not running` in `/tui/host/input` and `/tui/host/resize` to `HTTPException(400)`, matching the route's documented `errors(400)` response.
- Extracted real terminal buffer/resize behavior into `packages/overlay/src/services/tui-host-terminal.ts`:
  - growing snapshot writes only the delta;
  - unchanged snapshot writes nothing;
  - non-prefix snapshot resets the terminal before replaying;
  - duplicate terminal resize events are ignored.
- Updated `TuiHostPanel` to use the helper instead of keeping untested inline buffer/resize logic.
- Deleted retired overlay browser-side coding assistant files that were no longer mounted or imported by runtime code:
  - `packages/overlay/src/services/coding-assistant.ts`
  - `packages/overlay/src/services/coding-assistant-transcript.ts`
  - `packages/overlay/test/coding-assistant-service.test.ts`
- Added a deletion guard in `packages/overlay/test/coding-assistant-panel.test.ts` so the removed browser-assistant service does not silently return as a right-sidebar TUI double source.
- Kept the server-side `/coding/session*` and `coding-assistant/session.ts` provenance path intact because it remains the canonical right-sidebar session metadata source used by agent workflow tests.

Verified:

- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts`
- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts packages/opencorvus/test/tui/host.test.ts`
- `bun test packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/tui-host-terminal.test.ts packages/overlay/test/tui-host-service.test.ts packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun run --cwd packages/overlay typecheck`

OpenCode comparison after the round:

- Matched more of OpenCode's PTY route discipline by adding explicit route behavior coverage for input, resize, snapshot, stop, and stopped-host errors.
- Improved overlay terminal correctness by testing buffer cursor-like replay behavior, even though the transport is still snapshot-based rather than OpenCode's WebSocket cursor stream.
- Reduced right-sidebar double-source risk by deleting the old overlay browser assistant session/transcript client. The remaining right-sidebar mounted surface is the ghostty-backed TUI host.

OpenCode gap after the round:

- `/tui/host/start` success is still covered indirectly through `TuiHost.startPrepared()` and lower-level `Tui.resolveEmbeddedCommand()` tests, not by a stable full route-start process test. A direct route-start test should wait for the OpenCode-style PTY service/ticket model or a deterministic embedded command injection seam.
- OpenCode's `/pty` WebSocket/cursor/connect-token/list/remove model is still missing. The current route tests intentionally validate the existing host surface; they do not claim parity with OpenCode's PTY service.
- Full component lifecycle behavior still lacks a browser/DOM test because overlay has no DOM test runtime and browser automation was blocked in Round 12. The pure terminal helper tests cover buffer and resize behavior, but not ghostty canvas rendering, focus, active=false startup suppression, or toolbar interaction in a real document.
- Project-bound Agent Team tool/plugin surface, external TUI plugin loader/install, move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 14: moved host polling from full snapshots to cursor deltas

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 13.
- Copied the important OpenCode PTY buffer idea into the current right-sidebar host surface:
  - host sessions now track `cursor` and `bufferCursor`;
  - every PTY data chunk advances `cursor`;
  - retained buffer trimming advances `bufferCursor`;
  - `cursor=-1` starts at the current end, matching OpenCode's attach semantics.
- Added `GET /tui/host/output?cursor=`:
  - returns `{ data, cursor, from, truncated }` plus the existing host info;
  - returns only output after the requested cursor;
  - returns empty data when the client is already at the end;
  - marks `truncated=true` when the requested cursor predates the retained buffer.
- Updated overlay `TuiHostPanel` to poll `loadTuiHostOutput(hostCursor)` instead of pulling full `/tui/host/snapshot` every 500 ms.
- Added `writeTuiHostTerminalOutput()`:
  - writes cursor deltas directly;
  - writes nothing for empty deltas;
  - resets and replays retained output when the server reports truncation.
- Removed the old production snapshot-diff helper so the panel has one output replay model.

Verified:

- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts packages/opencorvus/test/tui/host.test.ts`
- `bun test packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/tui-host-terminal.test.ts packages/overlay/test/tui-host-service.test.ts packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`

OpenCode comparison after the round:

- Matched OpenCode's PTY retained-buffer cursor concept at the current `/tui/host/*` boundary.
- Reduced overlay transport waste: the browser no longer repeatedly downloads the whole retained terminal buffer.
- Preserved the existing agent workflow and host process model: only terminal-output replay changed; session prompt, task queue, permissions, questions, and panel tools are untouched.

OpenCode gap after the round:

- This is still HTTP polling, not OpenCode's `/pty/:id/connect` WebSocket attach path. Direct WebSocket streaming, connect-token validation, and server push are still missing.
- The current host remains a single project-bound embedded TUI host, not OpenCode's multi-PTY `list/create/get/update/remove` service.
- `GET /tui/host/snapshot` remains as a diagnostic/recovery route. It is no longer the overlay render loop source, but a later full PTY migration should either delete it or clearly keep it as a non-rendering debug surface.
- Browser visual E2E, project-bound Agent Team tool/plugin surface, external TUI plugin loader/install, move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 15: copied OpenCode one-use PTY connect ticket contract

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 14.
- Compared against OpenCode's current PTY ticket sources:
  - `.tmp/opencode-upstream/packages/core/src/pty/ticket.ts`
  - `.tmp/opencode-upstream/packages/opencode/src/server/shared/pty-ticket.ts`
  - `.tmp/opencode-upstream/packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts`
  - `.tmp/opencode-upstream/packages/opencode/test/server/httpapi-listen.test.ts`
- Added an Instance-scoped right-sidebar host connect ticket store in `packages/opencorvus/src/tui/host.ts`:
  - `issueConnectToken()` mints a random one-use token for the running host;
  - tokens expire after 60 seconds, matching OpenCode's production lifetime;
  - tokens are scoped to host id and project directory;
  - wrong host id or directory does not consume the token;
  - successful consume removes the token;
  - start, stop, and Instance disposal clear outstanding tokens.
- Added OpenCode-compatible ticket constants for the current host surface:
  - query key `ticket`;
  - header `x-opencode-ticket`;
  - header value `1`.
- Added `POST /tui/host/connect-token`:
  - requires `x-opencode-ticket: 1`;
  - returns `{ ticket, expires_in }`;
  - returns 403 when the header contract is missing;
  - returns 404 when no project-bound host is running.
- Regenerated SDK and OpenAPI docs so the route is part of the public contract:
  - `packages/sdk/openapi.json`
  - `packages/sdk/js/src/gen/sdk.gen.ts`
  - `packages/sdk/js/src/gen/types.gen.ts`
  - `packages/web/src/content/docs/reference/api.mdx`
  - `packages/web/src/content/docs/zh-cn/reference/api.mdx`

Verified:

- `bun test packages/opencorvus/test/tui/host.test.ts`
- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts`
- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`

OpenCode comparison after the round:

- Matched OpenCode's short-lived, one-use, scoped connect-ticket semantics at the current single-host boundary.
- Matched OpenCode's ticket issuance header name/value so the future attach client can use the same visible contract.
- Preserved the existing agent workflow: no session prompt, task, permission, panel, or coding route behavior was changed.

OpenCode gap after the round:

- The ticket is now available, but the current right-sidebar host still lacks OpenCode's `/pty/:id/connect` WebSocket path that consumes the ticket and streams output/input directly.
- The host still exposes a single embedded right-sidebar TUI process instead of OpenCode's multi-PTY `list/create/get/update/remove` service.
- The route currently validates the ticket issuance header but does not yet implement OpenCode's browser-origin check because the corresponding WebSocket/connect path has not been added.
- HTTP cursor polling remains the overlay render transport until the WebSocket attach path is implemented.
- Browser visual E2E, project-bound Agent Team tool/plugin surface, external TUI plugin loader/install, move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 16: added ticketed WebSocket attach and moved overlay off polling

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 15.
- Copied the next OpenCode PTY attach behavior into the current single-host surface:
  - added `GET /tui/host/connect?ticket=&cursor=` as a WebSocket upgrade endpoint;
  - consumes the one-use ticket before upgrade, matching OpenCode's invalid/reuse rejection behavior;
  - returns 400 for invalid query, 403 for invalid/reused ticket, and 404 when no host is running;
  - sends retained output from the requested cursor after connect;
  - streams future PTY output directly to every attached connection;
  - writes incoming WebSocket messages to the PTY;
  - closes attached sockets when the host exits or stops.
- Fixed the project route delegate in `packages/opencorvus/src/server/server.ts` to pass Hono/Bun env into `projectApp.fetch(...)`; without that, project-scoped WebSocket routes cannot access the Bun server for upgrade.
- Moved the right-sidebar overlay render path from HTTP cursor polling to ticketed WebSocket attach:
  - `TuiHostPanel` now calls `createTuiHostConnectToken()`;
  - opens `new WebSocket(buildTuiHostConnectUrl({ ticket, cursor }))`;
  - writes incoming chunks directly into `ghostty-web`;
  - sends keyboard input through `socket.send(data)`;
  - keeps HTTP resize for terminal size changes.
- Removed overlay service exposure for HTTP `input` and `output`, so the mounted right-sidebar UI has one input/output path.
- Deleted the retired overlay polling replay helper `writeTuiHostTerminalOutput()` and its tests.
- Regenerated SDK and API docs; route inventory now includes 225 operations.

Verified:

- `bun test packages/opencorvus/test/tui/host.test.ts`
- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts`
- `bun test packages/overlay/test/tui-host-service.test.ts packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/tui-host-terminal.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`

OpenCode comparison after the round:

- The right-sidebar host now has the core OpenCode connect-token plus WebSocket attach loop: ticketed connect, retained cursor replay, live output streaming, input over WebSocket, and single-use ticket rejection.
- The overlay no longer uses the old HTTP polling loop for rendering or HTTP input for keystrokes.
- Existing agent workflow remains untouched: no changes to session prompt execution, task queue, permissions, questions, panel tools, or `/coding/session*` provenance.

OpenCode gap after the round:

- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- The WebSocket route consumes tickets, but still lacks OpenCode's origin validation for connect requests.
- `GET /tui/host/snapshot` and `GET /tui/host/output` still exist as server diagnostics; they are no longer exposed by the overlay TUI service or used by the mounted right-sidebar render loop.
- Browser visual E2E, project-bound Agent Team tool/plugin surface, external TUI plugin loader/install, move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 17: copied OpenCode PTY origin validation

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 16.
- Compared against OpenCode's current origin validation sources:
  - `.tmp/opencode-upstream/packages/opencode/src/server/cors.ts`
  - `.tmp/opencode-upstream/packages/opencode/src/server/routes/instance/httpapi/handlers/pty.ts`
  - `.tmp/opencode-upstream/packages/opencode/test/server/httpapi-listen.test.ts`
- Extracted server origin policy into `packages/opencorvus/src/server/cors.ts` so HTTP CORS and PTY connect security share one source:
  - localhost and `127.0.0.1` origins are allowed;
  - Tauri origins are allowed;
  - `*.opencorvus.ai` origins are allowed;
  - explicit `Server.listen({ cors })` origins are allowed;
  - WebSocket requests with an `Origin` matching the request host are allowed.
- Updated `/tui/host/connect-token` to reject invalid origin with 403 in addition to the missing-header case.
- Updated `/tui/host/connect` to reject invalid WebSocket origin before consuming the one-use ticket.
- Added tests proving:
  - connect-token rejects `https://evil.example`;
  - WebSocket connect rejects `https://evil.example`;
  - rejected WebSocket origin does not consume the ticket, so the same ticket can still connect from an allowed origin.
- Regenerated SDK and API docs after the route description update.

Verified:

- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts packages/opencorvus/test/tui/host.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run api:routes-check`
- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`

OpenCode comparison after the round:

- Matched OpenCode's PTY connect-token and WebSocket connect origin validation behavior for the embedded right-sidebar host.
- Preserved ticket semantics: invalid-origin WebSocket attempts are rejected before consuming the token.
- Kept origin policy single-sourced instead of duplicating route-local origin checks.

OpenCode gap after the round:

- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- `GET /tui/host/snapshot` and `GET /tui/host/output` still exist as server diagnostics; they are no longer exposed by the overlay TUI service or used by the mounted right-sidebar render loop.
- Browser visual E2E, project-bound Agent Team tool/plugin surface, external TUI plugin loader/install, move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 18: removed HTTP input/output/snapshot double source

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 17.
- Compared against OpenCode's current PTY route group:
  - OpenCode exposes PTY `list/create/get/update/remove/connect-token/connect`.
  - It does not expose separate HTTP terminal `input`, retained-output `output`, or full-buffer `snapshot` routes.
- Deleted the remaining custom public HTTP routes from `packages/opencorvus/src/server/routes/tui.ts`:
  - `GET /tui/host/snapshot`
  - `GET /tui/host/output`
  - `POST /tui/host/input`
- Removed `loadTuiHostSnapshot()` from the overlay TUI host service. The overlay service already had no HTTP input/output exposure after Round 16.
- Updated route and overlay tests so the only right-sidebar terminal input/output path is the ticketed WebSocket attach route.
- Regenerated SDK and API docs; route inventory dropped from 225 to 222 operations, removing the three custom double-source routes from generated public contracts.

Verified:

- `bun test packages/opencorvus/test/server/tui-host-routes.test.ts packages/opencorvus/test/tui/host.test.ts`
- `bun test packages/overlay/test/tui-host-service.test.ts packages/overlay/test/tui-host-panel.test.ts packages/overlay/test/coding-assistant-panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`

OpenCode comparison after the round:

- Removed the leftover HTTP input/output/snapshot surface that did not exist in OpenCode's PTY API.
- The public right-sidebar host terminal path is now start/status/resize/stop plus connect-token/connect WebSocket, with input/output over the WebSocket.
- Existing agent workflow remains untouched: no session, task, permission, question, panel, or `/coding/session*` behavior changed.

OpenCode gap after the round:

- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- Browser visual E2E, project-bound Agent Team tool/plugin surface, external TUI plugin loader/install, move-session/workspace prompt flow, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 19: single-sourced right-sidebar agent-team capability surface

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 18.
- Recompared the local TUI file tree against `.tmp/opencode-upstream/packages/opencode/src/cli/cmd/tui` and confirmed remaining upstream gaps include:
  - `feature-plugins/system/session-v2.tsx`;
  - workspace and move-session prompt/dialog modules;
  - `component/use-connected.tsx`, background pulse, session footer/subagent-footer, and provider/model helper utilities.
- Removed the right-sidebar assistant action double source in `packages/opencorvus/src/tool/panel.ts`:
  - deleted `RIGHT_SIDEBAR_ASSISTANT_ALLOWED_ACTIONS`;
  - right-sidebar assistant authorization now derives from `panelCapabilityActionSet("right-sidebar")`;
  - the visible `/panel/capabilities` surface and callable panel tool surface now share one registry.
- Added `right-sidebar` to `PanelSurface` in `packages/opencorvus/src/panel/capability.ts`:
  - project/task/agent-team actions are exposed to the right-sidebar surface;
  - `set_executor`, `select_task`, and `select_session` are local actions for both `panel` and `right-sidebar`;
  - session management actions (`create_session`, `fork_session`, `delete_session`) are not exposed to right-sidebar;
  - `capture_overlay_screenshot` remains excluded from right-sidebar instead of being granted automatically.
- Added an OpenCode slot-based internal TUI plugin:
  - `packages/opencorvus/src/cli/cmd/tui/feature-plugins/sidebar/agent-team.tsx`;
  - registered as `SidebarAgentTeam` in `plugin/internal.ts`;
  - renders the right-sidebar project/agent-team tool surface through `sidebar_content`;
  - registers palette command `agent_team.tools`;
  - reads `panelCapabilities("right-sidebar")`, not a duplicated local list.
- Regenerated SDK/OpenAPI/docs so `/panel/capabilities?surface=right-sidebar` is part of the public contract.

Verified:

- `bun test packages/opencorvus/test/tui/plugin-runtime-guard.test.ts packages/opencorvus/test/tool/panel-capability.test.ts packages/opencorvus/test/tool/panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`
- `bun run api:routes-check`
- `bun run docs:check`
- `bun run --cwd packages/sdk/js typecheck`

OpenCode comparison after the round:

- The new `agent-team` plugin follows the copied OpenCode internal plugin/slot pattern instead of hard-coding another sidebar section into `routes/session/sidebar.tsx`.
- This is intentionally OpenCorvus-specific: OpenCode does not have OpenCorvus' project task board or agent-team control-plane registry, so the reusable OpenCode part is the plugin slot/keymap structure, not the business action list.
- The right-sidebar assistant's callable tool set now matches the visible right-sidebar capability surface, closing the reviewer-identified duplicate allowlist risk.

OpenCode gap after the round:

- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- The new `agent-team` plugin exposes the project-bound capability surface, but it does not yet render live task/agent activity rows from `EngineTaskTable`, queue state, or protocol interactions.
- Browser visual E2E, external TUI plugin loader/install, move-session/workspace prompt flow, `SessionV2Debug`, workspace label/connectivity UI, background pulse, and session/subagent footer modules remain missing.

### 2026-06-05 Round 20: live project task and agent rows in TUI state

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 19.
- Filled the Round 19 gap where the `agent-team` plugin only displayed static capabilities:
  - `SyncProvider` now loads `sdk.client.task.list({ limit: 8 })` into `project_board`;
  - task, run, permission, and question events refresh that project board;
  - `@opencorvus-ai/plugin/tui` exposes `state.project.board()`, `state.project.tasks()`, and `state.project.summary()`;
  - `createTuiApi()` maps those accessors from the same sync store.
- Extended the canonical project board projection instead of adding a TUI-only DB query:
  - `ProjectTaskSummary` now includes `active_sessions`;
  - `taskItems()` fills it through existing `listActiveSessionsForTask(task.id)`;
  - `/tasks` query parameters now use a real zod validator so SDK generation includes `limit`, `q`, and `status`.
- Updated the OpenCode-style `agent-team` sidebar plugin:
  - displays open/running task counts;
  - displays active agent count;
  - lists recent project tasks;
  - shows each task's active session count and pending interaction count;
  - still renders through `sidebar_content` and still gets tools from `panelCapabilities("right-sidebar")`.
- Regenerated SDK/OpenAPI/docs for the `/tasks` query and `active_sessions` response field.

Verified:

- `bun test packages/opencorvus/test/engine/active-sessions.test.ts packages/opencorvus/test/tui/plugin-runtime-guard.test.ts packages/opencorvus/test/tool/panel-capability.test.ts packages/opencorvus/test/tool/panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun run --cwd packages/sdk/js typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- The right sidebar still follows OpenCode's copied plugin-slot architecture: project task rows are rendered by an internal plugin, not by hard-coded session sidebar JSX.
- The data source is OpenCorvus-specific but canonical: it uses `/tasks`/SDK project board projection, equivalent in role to OpenCode's sync-backed state surfaces.
- This closes the previous project-binding shortfall for the sidebar: the TUI now shows live project task and active agent state, not only a static tool list.

OpenCode gap after the round:

- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- The `agent-team` plugin shows live rows but does not yet dispatch actions directly from rows; palette still only lists the command/tool surface.
- Browser visual E2E, external TUI plugin loader/install, move-session/workspace prompt flow, `SessionV2Debug`, workspace label/connectivity UI, background pulse, and session/subagent footer modules remain missing.

### 2026-06-05 Round 21: project task row actions in agent-team sidebar

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `107180701f626eaf97e0f032c4a46fe4b4e9c0ec`; no new TUI, PTY, app, or terminal files changed since Round 20.
- Closed the Round 20 row-action gap in the OpenCode-style `agent-team` internal plugin:
  - project task rows now open a task action dialog on mouse activation;
  - palette command `agent_team.tasks` opens the same project task action flow;
  - the action dialog is derived from `panelCapabilities("right-sidebar")`, not from a second right-sidebar allowlist.
- Extracted executable task action behavior into `agent-team-actions.ts` so the Solid/OpenTUI view and the test suite share the same implementation path without importing `.tsx` in non-JSX tests.
- Mapped right-sidebar task actions to canonical OpenCorvus SDK calls:
  - `select_task` persists `session.metadata.codingAssistant.selectedTaskID` through `coding.session.selection.update`;
  - `send_task_message` uses the existing OpenTUI dialog prompt and calls `task.message`;
  - `retry_task`, `replan_task`, and `cancel_task` call `task.retry`, `task.replan`, and `task.cancel`;
  - task API calls include the project directory from the task row or current TUI project state.
- Added the canonical selection contract instead of treating session navigation as task selection:
  - `PATCH /coding/session/:sessionID/selection`;
  - validates the target session is the current project's right-sidebar coding assistant session;
  - validates selected task project ownership before writing metadata;
  - preserves the existing `codingAssistant.surface` metadata source of truth.
- Kept the visible project/team controls in the copied OpenCode plugin-slot architecture. No hard-coded session sidebar JSX and no TUI-only DB query were added.
- Independent reviewer feedback corrected in this round:
  - removed the prior `right-sidebar-tui` source split and now uses `RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE`;
  - replaced the prior session-navigation interpretation of `select_task` with persisted selected-task metadata;
  - added a behavior test that invokes the real task-action module with a fake `TuiPluginApi` and asserts SDK payloads.

Verified:

- `bun test packages/opencorvus/test/server/coding-routes.test.ts packages/opencorvus/test/tui/plugin-runtime-guard.test.ts packages/opencorvus/test/tool/panel-capability.test.ts packages/opencorvus/test/tool/panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`
- `bun typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- OpenCode does not have OpenCorvus' project task board or agent-team control plane, so the business action set remains OpenCorvus-specific.
- The reusable upstream part is still the OpenCode TUI structure: internal feature plugin, sidebar slot rendering, command palette entry, dialog-select action flow, and prompt dialog.
- The right sidebar now behaves more like the screenshot target: a project-bound assistant surface can inspect context and act on todos/tasks instead of merely listing static capabilities.

OpenCode gap after the round:

- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- `reply_interaction` and `reject_interaction` are exposed by the capability registry but not yet available as row actions because the project board currently exposes only the pending count, not interaction IDs.
- Browser visual E2E, external TUI plugin loader/install, move-session/workspace prompt flow, `SessionV2Debug`, workspace label/connectivity UI, background pulse, and session/subagent footer modules remain missing.

### 2026-06-05 Round 22: pending interaction row actions in agent-team sidebar

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream advanced to `b1a7ee5695bded3ebe4282a17bfe91717edea363` (`feat(desktop): surface local server startup failures`). The changed files are under `packages/desktop/*`; upstream TUI/PTY/terminal files did not change in this range, so no TUI module copy was required in this round.
- Closed the Round 21 interaction-action gap:
  - `ProjectTaskSummary` now includes `pending_interaction_items`;
  - `taskItems()` derives both `pending_interactions` and `pending_interaction_items` from the same `listInteractions(task.id)` source;
  - the existing count remains a summary, while the new array is the actionable interaction read model.
- Extended the right-sidebar `agent-team` action flow:
  - task action dialogs now include `reply_interaction` and `reject_interaction` when pending interactions exist;
  - permission replies call `client.interaction.reply({ reply: "once", autoReply: false })`;
  - question replies use the existing OpenTUI prompt dialog and send a message reply;
  - rejects use the existing OpenTUI prompt dialog for an optional reason and call `client.interaction.reject`.
- Kept the capability source single:
  - interaction actions are still filtered through `panelCapabilities("right-sidebar")`;
  - no new right-sidebar action whitelist or TUI-only interaction endpoint was added.
- Regenerated SDK/OpenAPI docs for the project board response schema.

Verified:

- `bun test packages/opencorvus/test/engine/active-sessions.test.ts packages/opencorvus/test/tui/plugin-runtime-guard.test.ts packages/opencorvus/test/tool/panel-capability.test.ts packages/opencorvus/test/tool/panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun run --cwd packages/sdk/js typecheck`
- `bun run --cwd packages/sdk/js build`
- `bun run docs:api`

OpenCode comparison after the round:

- This remains an OpenCorvus-specific project/agent-team capability layer, but it is implemented inside the copied OpenCode plugin-slot/dialog architecture.
- The right sidebar now has actionable pending interaction rows instead of only showing a pending count, moving it closer to the OpenCode-style operational side panel shown in the target screenshot.

OpenCode gap after the round:

- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- Browser visual E2E, external TUI plugin loader/install, move-session/workspace prompt flow, `SessionV2Debug`, workspace label/connectivity UI, background pulse, and session/subagent footer modules remain missing.

### 2026-06-05 Round 23: provider connectivity helper

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `b1a7ee5695bded3ebe4282a17bfe91717edea363` (`feat(desktop): surface local server startup failures`); no new upstream TUI/PTY/terminal files changed since Round 22.
- Copied OpenCode's `component/use-connected.tsx` provider connectivity helper into OpenCorvus and adapted only the built-in provider id from `opencode` to `opencorvus`.
- Removed the inline `useConnected()` export from `component/dialog-model.tsx`; `DialogModel` and `app.tsx` now import the shared helper directly.
- Collapsed the repeated provider-connected predicate in `feature-plugins/home/tips.tsx` and `feature-plugins/sidebar/footer.tsx` into the same helper module through `isProviderConnected`.
- Kept the plugin API surface unchanged: internal plugins still read `api.state.provider`, while the predicate source is shared with the Solid hook.

Verified in tests:

- `plugin-runtime-guard.test.ts` now asserts the helper exists, preserves the OpenCode-derived predicate shape, imports the helper from `dialog-model` and `app`, and forbids the repeated provider-id predicate in home tips and sidebar footer.
- `bun test packages/opencorvus/test/tui/plugin-runtime-guard.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- This closes the local duplication against OpenCode's connectivity helper: OpenCorvus no longer carries three separate copies of the provider-connected predicate.
- The helper is still intentionally adapted to the OpenCorvus built-in provider id, because the provider branding/source is project-specific.

OpenCode gap after the round:

- Full OpenCode workspace/connectivity UI remains incomplete: `workspace-label.tsx`, workspace dialogs, move-session prompt flow, and unavailable-workspace dialog are still missing.
- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- Browser visual E2E, external TUI plugin loader/install, `SessionV2Debug`, background pulse, and session/subagent footer modules remain missing.

### 2026-06-05 Round 24: workspace label in sidebar footer

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `b1a7ee5695bded3ebe4282a17bfe91717edea363`; no upstream TUI/PTY/terminal files changed since Round 23.
- Copied OpenCode's `component/workspace-label.tsx` into OpenCorvus.
- Replaced the sidebar footer's hand-styled project path tail with `WorkspaceLabel`.
- Bound the label to existing OpenCorvus project state:
  - `connected` when `api.state.ready` is true and the project directory is present;
  - `connecting` while sync is not ready;
  - `disconnected` when no project directory is available.
- Kept branch display as label type (`git:<branch>`) when VCS state has a branch, otherwise `project`.
- Did not add fake workspace APIs or an OpenCode workspace control-plane compatibility layer.

Verified in tests:

- `plugin-runtime-guard.test.ts` now asserts `workspace-label.tsx` exists, keeps OpenCode's status color semantics, and is used by the sidebar footer.
- `bun test packages/opencorvus/test/tui/plugin-runtime-guard.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- OpenCorvus now has the same visual label primitive OpenCode uses for workspace/session context display.
- The right sidebar project binding is more visible and closer to the target screenshot's right-side status panel, while still using OpenCorvus' actual project sync state.

OpenCode gap after the round:

- OpenCode's full workspace management remains missing: workspace list/create/unavailable dialogs, move-session prompt flow, workspace commands, and workspace status event sync are not implemented yet.
- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- Browser visual E2E, external TUI plugin loader/install, `SessionV2Debug`, background pulse, and session/subagent footer modules remain missing.

### 2026-06-05 Round 25: background pulse renderable

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `b1a7ee5695bded3ebe4282a17bfe91717edea363`; no upstream TUI/PTY/terminal files changed since Round 24.
- Copied OpenCode's `component/bg-pulse.tsx` and `component/bg-pulse-render.ts` into OpenCorvus.
- Adapted only the source artwork and naming:
  - uses OpenCorvus' existing `cli/logo.ts` `logo.left/right` data instead of OpenCode's `go` logo;
  - renamed `GoUpsellArtPainter`/`go_upsell_art` to `LogoPulsePainter`/`logo_pulse_art`.
- Wired the copied `BgPulse` behind the default `home_logo` slot content so the module is visible code, not dead copied code.
- Preserved the OpenCode renderable approach: `FrameBufferRenderable`, cached frame-buffer drawing, theme-driven background/pulse colors, and temporary 30 FPS renderer tuning while mounted.
- Kept `home_logo` as a replaceable plugin slot, so existing plugin workflow can still replace the entire logo area.

Verified in tests:

- `plugin-runtime-guard.test.ts` now asserts the background pulse files exist, use the OpenTUI `FrameBufferRenderable` path, render from local logo data, and are mounted by the home route.
- `bun test packages/opencorvus/test/tui/plugin-runtime-guard.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- The previous `background pulse` gap is now closed for the home/logo surface using the same rendering architecture as OpenCode.
- The only intentional difference is artwork input: OpenCorvus uses its own logo while preserving OpenCode's animation/rendering implementation.

OpenCode gap after the round:

- OpenCode's full workspace management remains missing: workspace list/create/unavailable dialogs, move-session prompt flow, workspace commands, and workspace status event sync are not implemented yet.
- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- Browser visual E2E, external TUI plugin loader/install, `SessionV2Debug`, and session/subagent footer modules remain missing.

### 2026-06-05 Round 26: subagent footer placement

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `b1a7ee5695bded3ebe4282a17bfe91717edea363`; no upstream TUI/PTY/terminal files changed since Round 25.
- Copied OpenCode's `routes/session/subagent-footer.tsx` into OpenCorvus.
- Adapted only the project-specific imports and data contracts:
  - `@opencode-ai/sdk/v2` -> `@opencorvus-ai/sdk`;
  - `useOpencodeKeymap` -> `useOpencorvusKeymap`;
  - cost is calculated from OpenCorvus assistant messages, matching the existing session header source.
- Mounted `SubagentFooter` in the session route only for child/subagent sessions (`session()?.parentID`).
- Removed the duplicate subagent navigation controls from `routes/session/header.tsx`; Parent/Prev/Next now live in the OpenCode-style footer instead of two UI locations.
- Kept normal parent session prompt, permission, question, sidebar, and command bindings unchanged.

Verified in tests:

- `plugin-runtime-guard.test.ts` now asserts the subagent footer file exists, is mounted by the session route, contains the session navigation commands, and that the header no longer owns those commands.
- `bun test packages/opencorvus/test/tui/plugin-runtime-guard.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- The previous `session/subagent footer modules` gap is partially closed: the OpenCode `SubagentFooter` module is now present and used for subagent sessions.
- This also removes an older local divergence where subagent controls lived in the header.

OpenCode gap after the round:

- OpenCode's general `routes/session/footer.tsx` remains missing; OpenCorvus still relies on prompt/sidebar/footer plugins for the non-subagent status strip.
- OpenCode's full workspace management remains missing: workspace list/create/unavailable dialogs, move-session prompt flow, workspace commands, and workspace status event sync are not implemented yet.
- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- Browser visual E2E, external TUI plugin loader/install, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 27: general session footer

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream remained at `b1a7ee5695bded3ebe4282a17bfe91717edea363`; no upstream TUI/PTY/terminal files changed since Round 26.
- Copied OpenCode's `routes/session/footer.tsx` into OpenCorvus.
- Reused the already-copied/adapted OpenCorvus `context/directory.ts` and `component/use-connected.tsx`, so no new duplicate directory/provider readiness logic was added.
- Mounted `Footer` in the session route for normal parent sessions, while subagent sessions continue to use `SubagentFooter`.
- The footer surfaces the same OpenCode status strip concepts from canonical OpenCorvus sync state:
  - current project directory and branch;
  - provider connectivity;
  - pending permissions for the current session;
  - LSP count;
  - MCP connected/error status;
  - `/status` affordance.
- Kept prompt, permission/question prompts, sidebar, and subagent footer behavior unchanged.

Verified in tests:

- `plugin-runtime-guard.test.ts` now asserts the general footer exists, is mounted as the non-subagent fallback, and reads directory/connected/MCP/LSP/permission status from the copied TUI data sources.
- `bun test packages/opencorvus/test/tui/plugin-runtime-guard.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/plugin typecheck`
- `bun typecheck`
- `bun run api:routes-check`
- `bun run docs:check`

OpenCode comparison after the round:

- The previous `routes/session/footer.tsx` gap is now closed for the non-subagent session surface.
- OpenCorvus now has both OpenCode footer modules: general session footer and subagent footer, with mutually exclusive placement.

OpenCode gap after the round:

- OpenCode's full workspace management remains missing: workspace list/create/unavailable dialogs, move-session prompt flow, workspace commands, and workspace status event sync are not implemented yet.
- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- Browser visual E2E, external TUI plugin loader/install, and `SessionV2Debug` remain missing.

### 2026-06-05 Round 28: right sidebar browser visual E2E

Implemented:

- Rechecked latest OpenCode dev before editing. Upstream advanced from `b1a7ee5695bded3ebe4282a17bfe91717edea363` to `ab5a12d916dd72eab0c84afb1f6de5a07c16a7e4`.
- Audited the latest upstream TUI/server delta before choosing this round's scope:
  - `packages/opencode/src/cli/cmd/tui/context/sync-v2.tsx` changed in the watched TUI tree;
  - server/session V2 files also changed outside the copied TUI tree.
- Did not copy `sync-v2.tsx` or `SessionV2Debug` in this round because OpenCorvus does not yet have the canonical `@opencorvus-ai/sdk` V2 session-message/event surface or the matching HTTP sync route. Copying those files now would require fake message data or a parallel sync source, violating the no hand-written/fallback rule.
- Added `packages/overlay/test/tui-host-panel-visual.test.ts`, a real browser visual smoke test for the right sidebar TUI host panel.
- The test loads the built overlay dist through the existing overlay browser harness, binds `oc_directory`/`oc_server_url`, serves the project-scoped `/tui/host/*` HTTP API, upgrades `/tui/host/connect` to a WebSocket, and streams visible terminal text into the panel.
- The browser assertions verify:
  - the right activity TUI panel is active;
  - the panel title is `TUI`;
  - the terminal reports `running`;
  - no `.tui-host-error` is rendered;
  - the panel and terminal have stable visible dimensions in the right sidebar;
  - a real PNG screenshot is written and decoded with `sharp`, with non-trivial size and color diversity.
- The screenshot is written to a temporary file instead of using the overlay browser RPC binary return because the existing sidecar returns empty buffers for screenshot calls. This keeps the visual benchmark honest while avoiding a transport limitation unrelated to TUI rendering.

Verified in tests:

- `bun test packages/overlay/test/tui-host-panel-visual.test.ts`

OpenCode comparison after the round:

- The implementation is now measurably moving toward the target screenshot's right-side embedded TUI surface: a real browser opens the overlay, the right TUI panel is active, the terminal host is running, WebSocket output is rendered, and the screenshot is checked for nonblank visual content.
- This does not claim OpenCode visual parity yet. It closes the earlier `Browser visual E2E` validation gap so future OpenCode TUI copy rounds can be judged by rendered behavior, not static text matching.

OpenCode gap after the round:

- OpenCode's full workspace management remains missing: workspace list/create/unavailable dialogs, move-session prompt flow, workspace commands, and workspace status event sync are not implemented yet.
- The current host is still a single project-bound embedded TUI process, not OpenCode's full multi-PTY `list/create/get/update/remove` service.
- External TUI plugin loader/install remains missing; upstream depends on shared plugin loader modules that OpenCorvus does not yet expose in the copied TUI runtime.
- `SessionV2Debug` and `context/sync-v2.tsx` remain missing until the real V2 session-message/event source is copied/adapted.
