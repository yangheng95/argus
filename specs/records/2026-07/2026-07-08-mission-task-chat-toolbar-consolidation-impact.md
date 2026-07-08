# Mission / Task / Chat Toolbar Consolidation Impact

## Glossary

- UI: User Interface, the Overlay surfaces under `packages/overlay`.
- API: Application Programming Interface, the HTTP routes under `packages/opencorvus/src/server/routes`.
- SSE: Server-Sent Events, the live event stream used by selected task and session conversations.
- MCP: Model Context Protocol, the external/package tool protocol surfaced through OpenCorvus.
- DAG: Directed Acyclic Graph, used by task status snapshots for actual agent invocation lineage.
- DB: Database, the SQLite-backed durable storage behind sessions and engine tasks.

## Recall

| Field | Content |
| --- | --- |
| User request | "把左侧的toolbar左侧的mission，task和chat三个入口移除，再把mission，task合二为一，也就是从今以后mission负责管理task，注意关注mission的prompt和链路角色变化。再确保status查询能否覆盖到详细的task级别的status更新。输入框下方的外部执行器隐藏，位置改成下拉框选择mission/chat，需要使用kobalte统一风格。记忆toolbar移除，因为设置里面有，然后把skill/tool/mcp从toolbar移动到设置中。梳理我说的需求，细化并调查影响面" |
| Addendum request | "现在所有的chat，task和mission都在一个面板显示，有一个小标记标识是什么类型的条目，构思这个设计" |
| Acceptance criteria | Document the requirements, split implementation surfaces, prove current Mission/Task/Chat/toolbar/status/settings ownership from source, identify affected tests, and avoid code changes until the implementation plan is explicit. |
| Hard constraints | No fallback or compatibility path; no dual source; Mission becomes the user-visible task manager while `engine_task` remains the backend execution primitive; Settings remains the only Memory/Skill/Tool/MCP configuration surface; Kobalte select usage must flow through existing shared primitives; any later frontend implementation requires real browser screenshot review. |
| Sources read | `specs/artifacts/长程编排测试.md`; `specs/records/2026-07/2026-07-07-frontend-tool-portability-boundary.md`; `specs/records/2026-07/2026-07-01-browser-preview-native-webview-root-repair.md`; `specs/records/2026-07/2026-07-02-layout-geometry-build-consumption.md`; `specs/records/2026-07/2026-07-08-atomic-close-before-delete.md`; `specs/current/architecture/01-agents.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/04-extensions.md`; `specs/current/architecture/07-panel.md`; `specs/current/architecture/08-agent-tool-adapter.md`; `specs/current/architecture/07-panel-reactivity.md`; `specs/README.md`; `specs/records/2026-07/README.md`; the source and tests listed in the evidence tables below. |
| Whole-repository grep | `rg -n "type LeftActivity|LEFT_ACTIVITIES|selectedLeftActivity|selectMissionTask|openTaskLauncher|openMissionLauncher|openCodingAssistantLauncher|leftPanelTasks|leftPanelMissions|leftPanelAssistant|solidLeftActivityToolbar" packages/overlay/src`; `rg -n "ExecutorSelector|SelectControl|SettingsSelect|@kobalte/core/select|chat-compose-meta" packages/overlay/src packages/overlay/test`; `rg -n "MissionTaskProjection|TaskStatusDetail|MissionStatusSnapshot|loadMissionStatus|loadTaskStatus|missionStatusRecord|taskStatusDetailFromBoard|/status" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test`; `rg -n "missionTaskTitleInput|missionProvenance|mission.child_task_result|panel.create_task|query_task" packages/opencorvus/src specs/current`; `rg -n "MemoryPanel|SkillsPanel|ToolsPanel|McpPanel|ExtensionActivityPanel|CONFIG_SECTIONS|settings" packages/overlay/src packages/overlay/test`; `rg -n "side-activity-toolbar|leftPanel(Missions|Tasks|Assistant|Memory|Extensions)|mission-task-projection|coding-assistant|mission-new|sidebar-new-task-button" packages/overlay/test packages/overlay/src/styles`. |
| Independent agent feedback | Not launched in this turn because the available multi-agent tool explicitly forbids spawning sub-agents unless the user explicitly requests sub-agents or parallel agent work. This record therefore keeps the main-agent evidence trail complete rather than fabricating a second reviewer. |
| Current worktree note | The worktree was already dirty before this record, including Mission routes/tests, overlay conversation/sidebar files, and several July records. This investigation must not reset or overwrite those unrelated changes. |
| Latest user constraint | "task要么出现在mission的挂载项中，要么单独出现，不要重复出现". Work Ledger must classify each task into exactly one visible position: mountable Mission-owned tasks render only as Mission child rows; non-Mission or non-mountable tasks render only as top-level Task rows. Search must preserve this rule by returning the parent Mission when a Mission child task matches the query, rather than exposing the child as a duplicate top-level task. |
| Screenshot follow-up | 2026-07-08 screenshot showed a vertical empty strip between the Work ledger and conversation surface after `solidLeftActivityToolbar` removal. Source review found `packages/overlay/src/index.html` no longer mounts the left toolbar, but `packages/overlay/src/styles/surfaces/activity.css` still sized `.left-activity-shell` as `var(--ui-collapsed-pane-width) + var(--ui-sidebar-width)`. The retired toolbar width became empty inline space. The shell width must now match `var(--ui-sidebar-width)` and must not reference `var(--ui-collapsed-pane-width)` on the left side. |

## Requirement Split

1. Remove the left toolbar entries for Mission, Task, Chat, Memory, and Extensions. If no left activity entries remain, the `solidLeftActivityToolbar` mount and `leftActivityShell` fixed-control assumptions need to be retired or replaced by a Mission-owned sidebar shell.
2. Collapse the user-facing Task ledger into Mission. Task remains an `engine_task` execution primitive, but users should manage task rows through Mission projections, not a separate Task activity.
3. Keep Chat as a separate conversation mode, but move Chat access from the left toolbar to a composer-level Mission/Chat dropdown. The dropdown should control whether a new prompt starts/resumes Mission or Chat.
4. Hide the external executor selector currently under the input. The freed composer meta slot becomes the Mission/Chat dropdown. Any remaining executor/model controls must not be duplicated in the composer.
5. Remove the Memory toolbar entry because Settings already owns Memory.
6. Move Skill/Tool/MCP from the toolbar into Settings. Current source already has Settings tabs for Skill, Skill Market, MCP, and Memory, so implementation should delete the left compact entry rather than create a second settings surface.
7. Verify status queries cover detailed task-level updates. Backend Mission and Task status endpoints already exist; the missing piece is a Mission UI consumer for detailed task status.
8. Review Mission prompt and role chain. Mission should own planning, dispatch, reconciliation, and user reporting; it must not become a coding executor or replace the task orchestrator.

## Unified Work Ledger Design Addendum

The new product direction resolves the earlier open question about whether Chat keeps its own sidebar list: Chat, Task, and Mission should be rows in one panel. The panel should be a unified work ledger, not three old ledgers visually stacked together.

### Product Shape

The left panel becomes a single `Work` ledger:

- One header title, one search field, one scroll surface, one keyboard model, one project grouping model.
- Every row has a small kind marker at the far left:
  - Mission: mission icon, label `Mission`.
  - Task: task/list icon, label `Task`.
  - Chat: message icon, label `Chat`.
- The kind marker identifies the entity type. Status remains a separate field so type and lifecycle are not overloaded into one color chip.
- Rows are grouped by directory/project with the existing `ProjectLedgerGroup` visual model.
- Top-level rows sort by latest `updated` descending inside each project group.
- Mission-owned tasks appear once. They should render as child rows under their Mission when that Mission is expanded, not again as independent top-level duplicates.
- Standalone historical tasks, if any remain, appear as top-level Task rows with the Task marker until product policy removes or migrates them.
- Chat rows are top-level conversation rows with the Chat marker.
- A task row never renders in both places. The backend projection owns that classification; the frontend must not run a second de-duplication pass that can disagree with Mission status/task ownership.

### Row Anatomy

Use one shared row skeleton instead of three row components with near-identical markup:

```ts
type WorkLedgerRow =
  | { kind: "mission"; id: string; sessionID: string; title: string; directory: string; updated: number; status: "running" | "success" | "failed"; taskCounts: { total: number; success: number; failed: number; running: number } }
  | { kind: "task"; id: string; title: string; directory: string; updated: number; lifecycleStatus: "queued" | "active" | "completed" | "failed" | "cancelled"; missionID?: string; missionSessionID?: string }
  | { kind: "chat"; id: string; sessionID: string; title: string; directory: string; updated: number; status: "active" | "idle" | "terminal" }
```

`rowKey` should be `${kind}:${id}` so task IDs and session IDs cannot collide in the renderer.

Visual row layout:

1. `kind mark`: a fixed 18px icon chip with `data-kind`, neutral background, and accessible title such as `Mission` / `Task` / `Chat`.
2. `main`: one-line title, with second-line metadata only when needed. Examples: Mission task count, Task's owning Mission, Chat last message hint.
3. `status`: compact lifecycle/progress pill on the right. For Mission, show `3/5` or `running`; for Task, show lifecycle; for Chat, show active/idle only if meaningful.
4. `stamp`: existing relative updated time.
5. `actions`: per-kind row actions on hover/focus. Do not show invalid actions for a different kind.

The current `task-row-badge` can be split conceptually into:

- `work-row-kind-mark`: entity kind marker.
- `work-row-status-mark`: lifecycle/progress marker.

This avoids the current mismatch where Task uses the left badge for status while Mission and Chat use it for type.

### Interaction Model

Row selection:

- Mission row: selects the Mission session, hydrates its conversation, and loads Mission status detail.
- Task row: selects the task board/detail, using the row directory. If the task belongs to a Mission, keep the Mission context visible through the row's parent/metadata instead of jumping to a retired Task panel.
- Chat row: selects the Coding Assistant chat session.

Expansion:

- Mission rows can expand inline to show Mission-owned Task child rows and aggregate status.
- Project groups keep the existing directory collapse behavior.
- Task lineage expansion remains task-owned, but only inside a Task row/detail. Do not reintroduce the old TaskList tree as a separate panel.

Creation:

- The composer mode dropdown still belongs under the input and uses `SelectControl`: `Mission` or `Chat`.
- There is no default `New Task` mode. New tasks are created by Mission through `panel.create_task`.
- When a Task row is selected, the composer sends a task follow-up to that task, not a new top-level task.

Actions:

- Mission row: abort, download, rename, delete.
- Task row: cancel, rename, delete only if the backend currently supports those operations for that task state. Mission-owned task cancellation is still a real task cancellation, not a UI-only Mission flag.
- Chat row: stop, rename, delete.
- Delete actions must preserve the close-before-delete rule from `2026-07-08-atomic-close-before-delete.md`.

### Data Source

Preferred implementation is a single backend projection route for the ledger, for example `GET /work-ledger` after route-name grep during implementation. It should be a projection over existing Mission sessions, Coding Assistant sessions, and engine tasks; it must not add a new persistent ledger table.

Why backend projection is preferred:

- One pagination cursor instead of three independent cursors.
- One search query instead of three search implementations.
- One cross-kind sort by `updated`.
- One directory grouping result.
- No client-side race where Mission, Task, and Chat lists update at different times and produce misleading order.

The old `GET /mission`, task list projection, and Coding Assistant session list can remain as detail/action-specific APIs only if still used elsewhere, but they should not be the unified panel's list source. The unified panel must not render by mounting `TaskList`, `MissionList`, and `CodingAssistantSessionList` together.

### Status Detail

The unified row list should stay lightweight. It should include enough status summary for scanning, but should not call expensive task-board compilation for every row on every refresh.

Detailed status surfaces:

- Selecting a Mission row loads `GET /mission/:missionID/status` for aggregate and child task detail.
- Selecting a Task row loads `GET /task/:taskID/status`.
- Mission child task rows can show summary lifecycle from the ledger projection, and drill into detail on selection.
- Chat status continues to use session status / session list facts.

This keeps the existing detailed status APIs useful without turning the ledger into a hidden polling fallback.

### Component Direction

Create a new unified component family rather than adapting old components in place:

- `WorkLedger.tsx`: owns load/search/pagination/selection wiring.
- `WorkLedgerRow.tsx`: renders the discriminated row union and delegates per-kind actions.
- `WorkLedgerKindMark.tsx`: the small type marker.
- `work-ledger.css` or existing sidebar surface extension: owns row kind/status visuals.

Reuse existing primitives:

- `LedgerList`
- `ProjectLedgerGroup`
- `LedgerRowMainButton`
- `Button`
- `ArmedConfirmButton`
- existing `Icon` names

Retire or narrow old components after migration:

- `TaskList` should no longer be mounted as the primary ledger.
- `MissionList` should either become Mission-detail-only or be absorbed by `WorkLedgerRow`.
- `CodingAssistantSessionList` should either become Chat-detail-only or be absorbed by `WorkLedgerRow`.

If these components become dead code after the unified ledger lands, delete them in the same change after tests are updated. Do not keep hidden compatibility renderers.

### Visual Contract

The ledger should feel like an operational inbox, not a card stack:

- Dense rows with 8px or lower radius consistent with existing row primitives.
- No nested cards inside rows.
- Kind marker is small and consistent; do not assign large color bands per type.
- Status uses semantic tones already present in `sidebar.css`.
- Text must stay one-line by default with full title in native tooltip.
- Mission child tasks are indented by stable spacing, not by changing font size.
- Keyboard focus remains on one main row button per row, with action buttons reachable through the existing row action keyboard pattern.

### Tests For The Design

Required source/unit tests:

- `WorkLedger` is the only left panel list mounted for Mission/Task/Chat.
- `WorkLedgerRow` covers all three `kind` variants and renders `data-kind="mission" | "task" | "chat"`.
- Mission-owned tasks are not duplicated as both a Mission child row and top-level Task row.
- Search and pagination call one unified ledger service, not three list services.
- Row selection dispatches to the correct source: Mission session, Task board, Chat session.
- Composer mode select still uses shared `SelectControl`.

Required browser/visual tests:

- One panel screenshot with a Mission row, Mission child Task row, standalone Task row, and Chat row visible.
- Keyboard selection and row action reveal for each kind.
- Mission row expansion screenshot.
- Task status detail selection screenshot.
- Chat row selection screenshot.
- Settings Memory/Skill/Tool/MCP screenshot to prove those did not move back into the toolbar.

### Superseded Earlier Notes

The earlier "Mission sidebar + Chat ledger via mode select" framing is superseded by this addendum. The mode select remains for composer intent, but the left panel list itself is unified across Mission, Task, and Chat.

## Current Evidence

| Area | Current source evidence | Impact |
| --- | --- | --- |
| Left toolbar source | `packages/overlay/src/main.tsx` defines `type LeftActivity = "tasks" | "mission" | "assistant" | "memory" | "extensions"` and `LEFT_ACTIVITIES` with all five buttons. `packages/overlay/src/index.html` has `solidLeftActivityToolbar`, `leftPanelTasks`, `leftPanelAssistant`, `leftPanelMissions`, `leftPanelExtensions`, and `leftPanelMemory`. | Removing entries changes types, signal defaults, body activation, header actions, fixed pane sizing, and browser tests. |
| Mission task click | `selectMissionTask()` currently calls `resetCenterWorkbenchToFocusedPanel("tasks")`, sets `selectedLeftActivity("tasks")`, and then selects the task. | This directly contradicts "Mission manages task". A Mission task projection must stay in Mission context and show task detail/status without activating Task. |
| New buttons | `index.html` keeps three header buttons: `btnCreateTask`, `btnCreateMission`, and `btnCreateCodingAssistantSession`; `main.tsx` shows them by `data-left-action`. | Direct "New Task" should be removed from the user surface. Mission and Chat creation should be driven by the Mission/Chat mode dropdown plus submit behavior, or by Mission/Chat scoped controls inside their own surfaces. |
| Composer mode today | `main.tsx` derives `missionSubmitActive()` and `assistantSubmitActive()` from left activity/center panel state. `ChatComposer` only receives placeholder/data-ui differences. | The future Mission/Chat dropdown needs to become the primary source for composer mode, replacing left-activity-derived mode. |
| External executor today | `ChatComposer.tsx` imports and renders `<ExecutorSelector />` in `.chat-compose-meta-left`. `ExecutorSelector.tsx` owns OpenCorvus/external executor and model selection. | The composer-level external executor UI should be removed or hidden from this position. If executor selection remains product-visible, it needs an explicit Settings owner, not another composer control. |
| Kobalte select source | `packages/overlay/src/components/ui/SelectControl.tsx` is the only owner of `@kobalte/core/select`; `packages/overlay/test/select-control-single-source.test.ts` enforces that. Settings uses `SettingsSelect`, which delegates to `SelectControl`. | The Mission/Chat dropdown must use `SelectControl` or `SettingsSelect`. Do not add direct `@kobalte/core/select` imports. |
| Settings already owns Memory/Skill/MCP | `ConfigDialogHost.tsx` mounts `SkillsPanel`, `SkillMarketPanel`, `McpPanel`, and `MemoryPanel`; `store/dialog.ts` lists `skill`, `skill-market`, `mcp`, and `memory` in `CONFIG_SECTIONS`. | Toolbar removal should not add new Settings tabs for these. It should update tests to assert Settings remains the single surface. |
| Skill/Tool/MCP compact left panel | `main.tsx` mounts `ExtensionActivityPanel` into `solidLeftExtensionsPanel`; `SkillMarketPanel.tsx` exports `ToolsPanel`, `SkillsPanel`, `McpPanel`, and `ExtensionActivityPanel`. | Delete the left compact mount and related side-activity CSS/test expectations. Keep the Settings implementations. |
| Memory compact left panel | `main.tsx` mounts compact `MemoryPanel` into `solidLeftMemoryPanel`; Settings mounts non-compact `MemoryPanel`. | Delete the left compact mount; keep Settings Memory. |

## Mission And Task Chain

| Layer | Current behavior | Required boundary |
| --- | --- | --- |
| Session kind | `session.sql.ts` documents `mission` as the long-running goal owner that dispatches `engine_task` rows and does not execute concrete work. | Keep this contract. "Mission manages task" is a product surface and coordination ownership change, not a DB table merge. |
| Mission agent role | `agent.ts` wires `MISSION_CORE` with read/search/web/memory/wait/panel tools and no edit/write/apply_patch/bash. | Do not grant Mission executor tools. If prompt changes are needed, clarify reconciliation/status use, not implementation rights. |
| Mission prompt | `mission-core.txt` already requires `mission_state read`, `panel query_task`, `panel.create_task`, and status reconciliation through `tasks.md`. It also contains a stale-looking line allowing `explore` through the `task` tool while `agent.ts` says the generic task tool is excluded from Mission. | Prompt and actual tool pool should be reconciled. Prefer updating prompt wording to the real panel/query path instead of adding tools or a host-side route. |
| Task provenance | `task-api/index.ts` stamps Mission-created task titles and extracts `metadata.mission.{id, session_id}`. Terminal Mission tasks wake the Mission with `reason.source = "mission.child_task_result"`. | Preserve provenance. Mission-owned tasks should remain queryable and wake Mission after terminal updates. |
| Deletion/abort | The 2026-07-08 close-before-delete record notes Mission delete must close child tasks before session deletion. | Merging Mission/Task UI must not delete task rows before close/settlement is proven. |

## Status Query Coverage

Backend coverage is mostly present:

- `GET /mission/:missionID/status` builds `MissionStatusSnapshot` from all Mission-owned tasks.
- `GET /task/:taskID/status` returns `TaskStatusDetail` from the task board.
- `TaskStatusDetail` includes normalized task status, raw lifecycle status, progress, workflow steps, goal details, task agent outcomes, and `agentInvocationDAG`.
- `mission-routes.test.ts` already covers queued and completed tasks inside Mission status plus direct task status.
- Overlay service functions `loadMissionStatus()` and `loadTaskStatus()` exist and require explicit directories.

Gap:

- `Mission.tsx` and `MissionList.tsx` currently consume only the lightweight `MissionTaskProjection` returned by `GET /mission`; detailed `loadMissionStatus()` / `loadTaskStatus()` are covered by service tests but are not used by the UI.
- The overlay client `TaskStatusDetail` type currently omits `agentInvocationDAG` even though the backend schema includes it. If the UI starts rendering detailed task status, this type should be brought back into parity with the backend contract.

Recommended status direction:

1. Use `MissionStatusSnapshot` as the Mission detail source for all nested task status rows.
2. Add task-level drilldown only when the user selects a task row, using `loadTaskStatus()` with the clicked row's explicit directory.
3. Refresh status from existing Mission/session events or explicit user actions. Do not add blind polling as a hidden fallback.
4. Keep `panel query_task` for Mission-agent reconciliation and HTTP status snapshots for UI/operator inspection; do not make one silently substitute for the other.

## UI Implementation Impact

| File / area | Expected change |
| --- | --- |
| `packages/overlay/src/index.html` | Remove `solidLeftActivityToolbar`, `leftPanelTasks`, `leftPanelAssistant`, `leftPanelExtensions`, `leftPanelMemory`, compact mount IDs, and the direct New Task header action. Keep or redesign a Mission-first left/sidebar shell. |
| `packages/overlay/src/main.tsx` | Replace `LeftActivity` and left selection state with a Mission/Chat mode model. Delete Task/Assistant/Memory/Extensions activity switching. Change `selectMissionTask()` so it does not switch to Task. Remove left compact Settings mounts. |
| `packages/overlay/src/components/Mission.tsx` | Add detailed Mission status loading or pass status snapshots to `MissionList`. Keep row actions directory-scoped. |
| `packages/overlay/src/components/MissionList.tsx` | Render task projection detail/status under Mission. Task row selection should remain Mission-owned and may open a task status detail surface instead of the old Task ledger. |
| `packages/overlay/src/components/ChatComposer.tsx` | Remove `<ExecutorSelector />` from the composer meta row. Add a Mission/Chat select using `SelectControl` with the same Kobalte style family as the expert-squad selector. |
| `packages/overlay/src/components/ExecutorSelector.tsx` | If no remaining mount exists, retire or move to an explicit Settings owner. Avoid leaving unused dead code without a deletion decision. |
| `packages/overlay/src/components/ConfigDialogHost.tsx` / `store/dialog.ts` | Likely no new tabs needed for Memory/Skill/MCP. If executor selection moves to Settings, use `SettingsSelect`. |
| `packages/overlay/src/styles/surfaces/activity.css` | Remove left activity toolbar/body rules that only serve retired left controls. Keep right toolbar rules. |
| `packages/overlay/src/styles/surfaces/composer.css` | Replace executor-dualbar layout with Mission/Chat select styling. Preserve text-fit and compact-panel behavior. |
| i18n JSON | Remove retired activity tooltip keys only after tests prove no references remain; add Mission/Chat select labels. |

## Test Impact

Focused unit/source tests to update or add:

- `packages/overlay/test/left-activity-toolbar.test.ts`: replace old five-entry toolbar contract with "no left toolbar; Settings owns Memory/Skill/Tool/MCP; Mission owns tasks".
- `packages/overlay/test/mission-html-entry.test.ts`: update Mission-first HTML entry contract.
- `packages/overlay/test/coding-assistant-panel.test.ts`: Chat remains available via mode select, not left activity.
- `packages/overlay/test/mission-launcher-component.test.ts`: Mission task projection selection must not activate the Task ledger.
- `packages/overlay/test/mission-service-actions.test.ts`: extend status assertions if `agentInvocationDAG` is added to overlay type.
- `packages/overlay/test/select-control-single-source.test.ts` and `settings-primitives.test.ts`: keep passing; add a source assertion that composer mode select uses `SelectControl`.
- `packages/opencorvus/test/server/mission-routes.test.ts` and `packages/opencorvus/test/status/task-status-snapshot.test.ts`: keep detailed status coverage; add any missing nested status fields required by UI.
- Prompt/tool tests around Mission core should assert Mission prompt no longer references tools the mission role cannot see.

Browser/visual tests to update or replace:

- `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`: large rewrite. The left toolbar flow becomes Mission sidebar + composer Mission/Chat dropdown.
- `packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts`, `skill-mcp-panel-browser.test.ts`, and `skill-mount-matrix-browser.test.ts`: move selectors from `#leftPanelExtensions` / `#leftPanelMemory` to Settings dialog panels.
- `packages/overlay/test/browser/coding-assistant-directory-browser.test.ts`: open Chat via mode select rather than left assistant button.
- `packages/overlay/test/browser/task-deep-link-browser.test.ts`, `task-list-perf.test.ts`, `task-list-tree-click.test.ts`, `task-dirbar-keyboard.test.ts`: decide whether deep-linked tasks open a Mission-owned task detail or a backend task board view without a Task ledger.
- Any frontend implementation requires Playwright screenshots of the new Mission sidebar, Mission/Chat select popup, Settings Skill/MCP/Memory panels, and task status detail surface.

## Open Decisions Before Code

1. Should direct non-Mission task creation disappear from the user UI entirely, or remain as an internal/API-only path? The architecture-compatible answer is API-only unless another product surface explicitly needs it.
2. Where should historical standalone tasks appear after the Task ledger is removed? Either Mission should show only Mission-owned tasks and deep links open a task detail, or there needs to be a deliberate migration/archive view. Do not create a hidden second task ledger.
3. Should Chat keep a session list visible in the left/sidebar area, or should the Mission/Chat dropdown switch the sidebar body between Mission ledger and Chat ledger? The current request only removes the toolbar entries, not necessarily the Chat ledger itself.
4. If external executor selection remains user-facing, which Settings tab owns it? Today the composer `ExecutorSelector` appears to be the only full executor/model picker surface.

## Recommended Sequence

1. Update the Mission/Chat surface model in `main.tsx` and `index.html`: remove left toolbar as a source of truth, introduce a single composer mode signal, and keep Mission as the default.
2. Remove the standalone Task activity and make Mission task projections select Mission-owned task detail/status instead of switching to Task.
3. Add Mission status detail UI from `loadMissionStatus()` / `loadTaskStatus()` and align overlay status types with backend `TaskStatusDetail`.
4. Remove compact Memory/Extensions mounts and update Settings tests/selectors for Memory/Skill/Tool/MCP.
5. Replace the composer external executor slot with a `SelectControl` Mission/Chat dropdown.
6. Update Mission prompt/tool tests so the prompt matches actual Mission role capabilities and detailed reconciliation surfaces.
7. Run focused unit tests, backend route/status tests, then Playwright visual tests with screenshots for the changed UI surfaces.

## Non-Goals

- Do not merge `mission` sessions and `engine_task` rows into one DB table.
- Do not grant Mission file-editing or shell-execution tools.
- Do not preserve retired toolbar entries through hidden aliases or compatibility selectors.
- Do not add a second Settings implementation for Memory/Skill/Tool/MCP.
- Do not use DOM-only assertions as final validation for the frontend change.

## Execution Update - 2026-07-08

Implemented boundary:

- `WorkLedger` is now the only production left-panel Mission / Task / Chat list mount.
- Old production selectors and mount IDs for `solidLeftActivityToolbar`, `leftPanelTasks`, `leftPanelMissions`, `leftPanelAssistant`, `leftPanelMemory`, `leftPanelExtensions`, `btnCreateTask`, `btnCreateMission`, `btnCreateCodingAssistantSession`, `taskListPanel`, `MissionList`, `TaskList`, `CodingAssistantSessionList`, and `ExtensionActivityPanel` no longer appear in `packages/overlay/src`.
- The composer meta row uses a Kobalte-backed `SelectControl<ComposerModeOption>` for `Mission` / `Chat`; the old composer `<ExecutorSelector />` is not mounted there.
- Memory, Skill, Tool, and MCP remain Settings-owned through `ConfigDialogHost` / `CONFIG_SECTIONS`.
- Backend Work Ledger projection classifies each task once:
  - Mission-owned child tasks with complete `metadata.mission.{id, session_id}` render only under their parent Mission.
  - Standalone or non-mountable tasks render only as top-level Task rows.
  - Searching by a Mission child task returns the parent Mission row instead of duplicating the child as a top-level Task row.

Verification completed:

- `bun test packages/opencorvus/test/server/work-ledger-routes.test.ts packages/opencorvus/test/mission-prompt-work-ledger.test.ts packages/opencorvus/test/status/task-status-snapshot.test.ts` passed.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed.
- `bun test packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/visible-scrollbar-whitelist.test.ts packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/work-ledger-consolidation.test.ts` passed.
- `bun test packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/mission-html-entry.test.ts packages/overlay/test/mission-session-source.test.ts packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/file-explorer-editor.test.ts packages/overlay/test/notification-center-primitive.test.ts` passed.
- Playwright visual QA against isolated Vite port `5273` passed with screenshots:
  - `.scratch/work-ledger-qa/work-ledger-after-css-hover.png`
  - `.scratch/work-ledger-qa/work-ledger-mode-selector-open.png`

Verification limits:

- Full `bun run --cwd packages/overlay test:unit` was run and did not pass: `2095 pass / 330 fail / 5 errors`.
- The full-suite failures are broad existing/current-worktree failures in SSE, notification, workspace directory, task service, tauri transport, tree-writer, and unrelated architecture guards; they are not isolated to the Work Ledger surface.
- Browser test files under `packages/overlay/test/browser/**` still contain old left-toolbar selectors and need a separate migration to Work Ledger and Settings selectors before the browser suite can be treated as green.

## Visual Correction - Single-Line Work Rows

Follow-up request: "双行难看到爆".

The first Work Ledger implementation violated the Visual Contract above: Mission rows rendered a second line for task count (`2 tasks`), and Chat rows rendered a redundant second line (`Chat`). This made the ledger read as a loose two-line list rather than an operational inbox.

Corrected row contract:

- Work Ledger rows are one-line by default.
- The kind marker remains the type signal; do not repeat `Chat` / `Task` / `Mission` as a second text row.
- Mission task count and Mission-owned task context, when useful, render as inline metadata beside the title, not below it.
- CSS must not set `.work-row-main` to column layout or keep `.work-row-meta` as a block second line.
- Visual QA must confirm the project group contains one-line Mission / Task / Chat rows.

Verification:

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/project-delete-button.test.ts` passed.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed.
- `git diff --check` passed.
- Isolated Vite + Playwright visual QA wrote `.scratch/work-ledger-single-line.png`; measured top-level Mission and Chat rows at `31px` height, `.work-row-main` as `flex-direction: row`, `legacyMetaCount: 0`, and no Chat inline type repetition.
