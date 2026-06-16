# Gateway Task Management Implementation Brief

> Date: 2026-05-14
> Status: Product requirements draft
> Owner surface: Overlay
> Related code: `packages/overlay/src/index.html`, `packages/overlay/src/main.tsx`, `packages/overlay/src/services/task.ts`, `packages/opencorvus/src/server/routes/gateway.ts`, `packages/opencorvus/src/server/routes/channel.ts`, `packages/opencorvus/src/channel/ingress.ts`, `packages/opencorvus/src/channel/supervisor.ts`, `packages/opencorvus/src/task-api/index.ts`
> Related docs: `specs/new-arch/02-data.md`, `specs/new-arch/03-control.md`, `specs/new-arch/13-agent-communication-matrix.md`, `specs/new-arch/2026-05-14-directory-queue-hard-gate.md`, `packages/web/src/content/docs/zh-cn/channels/overview.mdx`

## Glossary

- brief: product requirements source for implementation and acceptance.
- API: Application Programming Interface, the server contract consumed by Overlay and external clients.
- UI: User Interface, the rendered operator-facing page and controls.
- UX: User Experience, the intended interaction flow and usability behavior.
- MVP: Minimum Viable Product, the first implementation scope that proves the Gateway page shape.
- SSE: Server-Sent Events, the existing one-way event stream used for task and global updates.
- HTTP: Hypertext Transfer Protocol, the request/response protocol for the server API.
- Tauri: the desktop application shell used by Overlay.

## 1. Background

OpenCorvus already has three separate capabilities:

- A task-centric execution model: `engine_task`, `engine_goal`, `engine_artifact`, `EngineService`, task board, task events, retry, replan, cancel, and operator messages.
- A channel ingress path: external platform message -> `ChannelIngress.message()` -> bound task or `ControlMessage.handle()` -> task/control-plane action.
- A managed channel runtime: channel adapters, `ChannelSupervisor`, `/channel/runtime`, and `/gateway/*` HTTP routes.

The current Overlay default experience is still a conversation panel: left recent chats, center conversation, right inspector/preview. This is useful for one task, but it is not a Gateway control surface. Users need a separate entry point where they can manage work from the task perspective: decompose large requirements into smaller tasks, inspect task queues and bindings, and connect or supervise channels.

This template defines Gateway as an Overlay page and product surface. Gateway is not a second task runtime. It is a task-first management page over the existing OpenCorvus task, goal, channel, and control APIs.

## 2. Product Goal

Gateway gives the operator one place to control OpenCorvus work across tasks and channels.

The page must:

1. Preserve the current Overlay panel as the default screen.
2. Provide a visible Gateway entry from the default panel.
3. Open a separate Gateway page focused on tasks, not chat.
4. Let users break a large requirement into small executable tasks.
5. Let users start, queue, inspect, cancel, retry, replan, and message tasks.
6. Let users view and manage channel connections and channel-thread-to-task bindings.
7. Reuse the existing task/channel/control back end as the single source of truth.

## 3. Non-Goals

- Do not embed OpenClaw as a second gateway process.
- Do not create a second task model, task database, session router, queue, or notification ledger.
- Do not introduce fallback behavior when channel status, task status, or binding data cannot be loaded. Show explicit error states.
- Do not move workspace/panel-level controls into the window titlebar. Gateway is a page-level and task-level surface.
- Do not implement channel-specific business logic in the Gateway UI. Platform differences stay in adapters and channel config.
- Do not use dropdowns for small mutually exclusive choices such as start-when-idle vs queue.

## 4. Users

Primary user: a developer/operator running OpenCorvus locally who wants to supervise multiple tasks and remote channels from one place.

Secondary user: a mobile or chat-channel operator who starts work remotely and later opens Overlay to inspect, split, steer, or finish tasks.

## 5. Core Mental Model

Gateway is a control room organized around tasks:

```text
Large requirement
  -> decomposition proposal
  -> small task candidates
  -> task create / queue decisions
  -> task board and execution state
  -> channel bindings and notifications
```

Channel is an input and notification surface. Task remains the center.

The authoritative sources are:

- Task state: `engine_task` and projected board APIs.
- Goal/task decomposition: existing requirements/architect/orchestrator output and task creation APIs.
- Channel binding: `engine_channel_binding`.
- Channel runtime status: `ChannelSupervisor`.
- Events: existing task/global SSE streams.

## 6. Entry And Navigation

### 6.1 Default Overlay

The app still opens to the current panel:

- left: recent chats/tasks
- center: conversation
- right: inspector/preview
- bottom/inline: existing workflow rail and workspace surfaces

### 6.2 Gateway Entry

Gateway must have one primary entry in the default panel. Recommended location:

- left sidebar header or sidebar footer, because Gateway controls the task list and channel ingress as a workspace-level surface.

Do not put Gateway into the window titlebar unless it becomes an app-level navigation item shared by all workspaces. The initial implementation should keep ownership inside the workspace/panel layer.

The entry label: `Gateway`.

Click behavior:

- Switches the main Overlay body to Gateway page.
- Keeps the current server connection and selected workspace.
- Does not clear selected task, conversation, or board state.

### 6.3 Return To Panel

Gateway page must provide a clear `Panel` or `Back to Panel` action. Returning to Panel restores the current default Overlay view and current selected task.

## 7. Gateway Page Layout

Gateway is a separate page, not a modal and not a right-panel tab.

Recommended layout:

```text
+--------------------------------------------------------------+
| Gateway header: workspace, health, channel runtime, actions  |
+---------------+------------------------------+---------------+
| Task ledger   | Task workbench               | Channel side  |
| filters/list  | selected task/decomposition  | connections   |
+---------------+------------------------------+---------------+
```

### 7.1 Header

Shows:

- current workspace directory
- gateway health
- channel runtime status
- counts: active, queued, failed, completed
- actions: New requirement, Refresh, Back to Panel

### 7.2 Task Ledger

Task ledger is the primary navigation column.

Required:

- list project tasks and global tasks if the API supports it
- status filters: active, queued, failed, completed, cancelled, all
- text search by title/id
- selected task highlight
- queued task ordering controls only for tasks that are actually queued
- per-task quick actions: cancel, retry, delete where applicable

### 7.3 Task Workbench

When a task is selected, show:

- title, id, status, priority, executor, directory
- current progress and latest report
- goals / milestones / requirement trace
- recent artifacts and changed files
- interactions awaiting reply
- task actions: message, cancel, retry, replan, open in Panel

When no task is selected, show the requirement decomposition composer.

### 7.4 Channel Side Panel

Shows:

- configured channels
- runtime status per channel
- last error/detail
- restart runtime action
- known channel/thread bindings for the selected task
- inbound channel messages that created or updated the selected task, if available

Channel configuration can link to the existing settings/config channel editor. Gateway should not duplicate the entire secret-editing form unless the existing settings component is reused as the single implementation.

## 8. Large Requirement Decomposition

### 8.1 User Flow

User enters a large requirement in Gateway. Gateway produces a decomposition proposal before creating tasks.

The proposal contains:

- summary of the large requirement
- small task candidates
- suggested order
- dependencies
- acceptance criteria per task
- risk notes
- recommended execution mode per task: start when idle or queue

### 8.2 Required Interaction

For each proposed small task:

- title
- description
- acceptance criteria
- priority
- executor
- queue choice using a segmented control or cards:
  - Start when idle
  - Queue
- include/exclude toggle

The default for low-risk new task creation is Start when idle, consistent with
`2026-05-14-directory-queue-hard-gate.md`. Queue must be explicit, but task
creation must still respect the same-directory active-task gate.

### 8.3 Creation Behavior

On confirmation:

- included candidates become normal OpenCorvus tasks via existing task creation APIs
- candidates with Start when idle use omitted `queue` or `queue: false`
- candidates with Queue use `queue: true`
- created tasks appear immediately in Task Ledger

If task creation fails, the failed candidate remains visible with the exact error. Gateway must not silently skip it or retry through another endpoint.

### 8.4 Decomposition Source

The first implementation may call an existing control/task capability if it can produce structured task candidates. If no existing endpoint returns this shape, add a dedicated API that reuses the existing requirements/architect/orchestrator contracts and returns a proposal without creating tasks.

The proposal must not be stored as a second task plan source. Once tasks are created, the created tasks and their artifacts are authoritative.

## 9. Task Management Requirements

Gateway must support:

- create task from freeform requirement
- decompose large requirement into small task candidates
- create selected small tasks
- select task
- open selected task in default Panel
- append operator message to selected task
- reply to pending interaction
- cancel task
- retry task
- replan task
- reorder queued tasks
- delete task when supported by existing task API
- inspect board, conversation, runs, trace, interactions, artifacts, and transcript

Gateway must distinguish:

- queued task
- active running task
- waiting for user input
- failed task
- cancelled task
- completed task

Status labels may be UI-facing, but task reachability and message routing cannot be gated by UI lifecycle states.

## 10. Channel Requirements

Gateway must support:

- list supported channels
- show configured/missing/partial/disabled state
- show runtime state: disabled, unavailable, starting, running, stopped, error
- restart managed channel runtime
- show task binding for `(platform, channel, thread) -> task`
- route external channel message to bound task through existing `ChannelIngress`
- show explicit error when an inbound message targets an unbound thread and creation is not allowed
- expose channel docs/config entry

Gateway should eventually support multiple accounts per channel if the back end gains a single-source account model. Do not fake multi-account support in the UI with ad hoc metadata.

## 11. API Surface

Use existing endpoints first:

- `GET /tasks`
- `GET /global/tasks`
- `GET /task/{taskID}`
- `GET /task/{taskID}/board`
- `GET /task/{taskID}/conversation`
- `GET /task/{taskID}/events`
- `POST /task`
- `POST /task/{taskID}/message`
- `POST /task/{taskID}/cancel`
- `POST /task/{taskID}/retry`
- `POST /task/{taskID}/replan`
- `PATCH /task-queue/reorder`
- `GET /channel`
- `GET /channel/runtime`
- `POST /channel/runtime/restart`
- `POST /gateway/channel/{platform}/message`
- `GET /gateway/stats`
- `GET /gateway/capabilities`
- `POST /gateway/control/action`

Likely new endpoint:

- `POST /gateway/task/decompose`

Draft response shape:

```ts
type GatewayTaskDecomposition = {
  proposal_id: string
  requirement: string
  summary: string
  tasks: Array<{
    id: string
    title: string
    description: string
    acceptance: string[]
    priority: "critical" | "high" | "normal" | "low"
    executor?: "opencorvus" | "codex" | "claude-code"
    recommended_queue: boolean
    dependencies: string[]
    risks: string[]
  }>
}
```

This endpoint only proposes. It does not create tasks.

## 12. Data Model

No new task tables for MVP.

Allowed additions:

- an ephemeral proposal response from `/gateway/task/decompose`
- optional persisted artifact on an existing task only if the decomposition was initiated from an existing task and must be audited

Do not add a Gateway task table. Do not mirror `engine_task` into Gateway-specific state.

If persistent proposal history becomes necessary later, it must use `engine_artifact` with a new explicit `kind`, and the artifact must be tied to the task or root session that produced it.

## 13. UX Requirements

- Dense, operational UI. No marketing hero page.
- Gateway page must be usable with many tasks.
- Avoid card-heavy decoration. Use tables, rows, split panes, segmented controls, badges, and compact toolbars.
- Icons in icon buttons should use the existing `Icon` component/lucide mapping where available.
- Text must fit on narrow widths and mobile.
- The channel side panel must not block task management.
- Error states must be visible and actionable.
- Loading states must preserve layout dimensions.

## 14. Error Handling

No fallback behavior.

Required explicit errors:

- gateway stats cannot load
- task list cannot load
- task board cannot load
- decomposition request failed
- one proposed task failed to create
- channel runtime status cannot load
- channel restart failed
- channel message could not bind or route
- task action failed

Each error must show:

- operation
- target task/channel if known
- server message
- retry action only when retrying the same operation is valid

## 15. Telemetry And Observability

Gateway should surface existing logs/events rather than invent its own telemetry.

Required:

- use task/global SSE to refresh task state
- show channel runtime status from `ChannelSupervisor`
- show latest gateway stats timestamp
- expose task debug/open-in-panel for selected task

Future:

- channel probe history
- per-channel last inbound/outbound message
- task pressure summary
- failed action audit list

## 16. Permissions And Security

- Gateway uses the same authenticated server session as Overlay.
- Channel secrets remain in existing config/settings flows.
- Gateway control actions must remain constrained by `PanelCapabilityRegistry` or explicit server routes.
- Gateway action endpoint must not ask interactive tool permissions from a fake context.
- Remote/mobile gateway access, if added later, must have explicit auth and must not expose the local server unauthenticated.

## 17. Acceptance Criteria

1. Overlay default page remains the current panel.
2. A visible Gateway entry opens a separate Gateway page.
3. Gateway page can return to the default panel without losing selected task.
4. Gateway Task Ledger lists tasks and updates when tasks change.
5. Selecting a task shows task details, goals/progress, interactions, and actions.
6. `Cancel`, `Retry`, `Replan`, and operator message actions call existing task APIs and show exact failures.
7. Large requirement composer returns a structured decomposition proposal before task creation.
8. Proposed small tasks can be included/excluded.
9. Each proposed task uses a visible Start when idle / Queue segmented choice.
10. Omitted queue and Start when idle make tasks eligible to start when the same directory is idle; Queue creates directory-queued tasks.
11. Created tasks appear in the ledger with correct status.
12. Gateway shows channel list and managed runtime status.
13. Gateway can restart managed channel runtime.
14. Selected task shows channel/thread bindings when available.
15. Gateway does not create or read a Gateway-specific task table.
16. Gateway does not silently degrade on failed task/channel/decomposition requests.

## 18. Test Plan

### Unit

- Gateway page state model:
  - page switch preserves selected task
  - task filters do not mutate task data
  - Start when idle maps to omitted `queue` or `queue: false`
  - Queue maps to `queue: true`
- Decomposition proposal:
  - required fields validate
  - dependency ids must refer to proposed task ids
  - failed creation marks only that candidate failed
- Channel status projection:
  - configured/missing/partial/disabled states render distinctly
  - runtime error renders explicit error

### API

- `/gateway/task/decompose` returns proposal and creates no task.
- task creation from proposal calls existing create task path.
- queue opt-in behavior matches `2026-05-14-directory-queue-hard-gate.md` (superseded the earlier task-queue-opt-in plan).
- channel runtime restart returns updated status.
- gateway channel message delegates to `ChannelIngress`.

### Integration

- Create a large requirement, decompose into at least three tasks, start one when its directory is idle and queue another.
- Verify ledger and board states match backend task APIs.
- Bind a channel thread to a task, send a channel message, verify the message reaches the same task.
- Trigger a pending interaction and reply from Gateway.

### Visual

- Desktop default panel.
- Desktop Gateway page.
- Narrow sidebar collapsed/expanded.
- Mobile or narrow viewport.
- Light, dark, and vscode-dark themes.

Visual checks must use visible rendering or screenshots, not headless-only assertions.

## 19. Implementation Phases

### Phase 1: template And Page Shell

- Add Gateway template.
- Add Overlay page mode: `panel | gateway`.
- Add Gateway entry and return action.
- Add empty Gateway page shell with task-ledger/workbench/channel regions.

### Phase 2: Task Ledger And Workbench

- Load task lists.
- Select task.
- Show task summary/board.
- Wire task actions to existing APIs.
- Add explicit error states.

### Phase 3: Decomposition

- Add `/gateway/task/decompose` if no existing structured proposal path fits.
- Add decomposition composer and proposal review.
- Add include/exclude and Start when idle / Queue controls.
- Create selected tasks through existing task creation.

### Phase 4: Channel Management

- Show channel catalog/config status.
- Show managed runtime status.
- Add restart runtime.
- Show selected task bindings.
- Link channel config/docs.

### Phase 5: Review And Hardening

- Add tests.
- Run typecheck/API/docs checks.
- Visible UI review.
- Re-read template against implementation and remove any accidental double-source state.

## 20. Open Questions

1. Should Gateway be a page mode inside the single Tauri window, or a route-like URL state for browser reload/deep-linking?
2. Should decomposition be allowed without creating a parent task, or should every decomposition attach to a root task for audit?
3. Should channel bindings be editable manually in Gateway, or only created by inbound messages/task actions?
4. Should global task list be shown by default, or only current project tasks with a global toggle?
5. Should Gateway eventually become the remote/mobile control protocol surface, or remain Overlay-only for the first release?
