# HTTP API reference

All HTTP endpoints exposed by `opencorvus serve`, grouped by module. Route registration: `packages/opencorvus/src/server/app.ts` + `server.ts`.

## Authentication

All endpoints are protected by `OPENCORVUS_SERVER_PASSWORD`. When set, clients must provide HTTP Basic Auth (empty username, password = env var value).

## Endpoints by module

### Global

| Method | Path | Purpose |
|---|---|---|
| GET | `/global/health` | Health check |
| GET | `/event` | Primary SSE event stream |
| PATCH | `/global/config` | Update global config (emits `config.changed`) |
| POST | `/global/dispose` | Dispose instance (emits `global.disposed`, then closes) |

Source: `src/server/routes/global.ts`

### Task / Orchestrator

Core business routes (`src/server/routes/orchestrator.ts`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/task` | Create task; 503 on planner failure |
| GET | `/tasks` | List tasks |
| GET | `/task/:id` | Task detail |
| GET | `/task/:id/board` | Kanban view |
| GET | `/task/:id/progress` | Progress aggregate |
| GET | `/task/:id/brief` | Brief summary |
| GET | `/task/:id/transcript` | Conversation transcript |
| GET | `/task/:id/runs` | Run list |
| GET | `/task/:id/interactions` | Interaction history |
| GET | `/task/:id/events` | **SSE task detail stream** (`?after=<sequence>` for resumption) |
| POST | `/task/:id/message` | Append follow-up message |
| POST | `/task/:id/inject` | Inject message into an active session |
| POST | `/task/:id/retry` | Retry with same plan |
| POST | `/task/:id/replan` | New plan version; 503 on planner failure |
| POST | `/task/:id/cancel` | Cancel |
| GET | `/task/events` | **SSE task-list change notifications** |
| GET | `/run/:id` | Run detail |
| GET | `/run/:id/executor` | Run executor status |
| POST | `/interaction/:id/reject` | Reject an interaction request |
| PATCH | `/goal/:id` | Update goal description and criteria |
| DELETE | `/goal/:id` | Delete goal |

### Session

`src/server/routes/session-*.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/session` | List / create |
| GET/DELETE | `/session/:id` | Detail / delete |
| POST | `/session/:id/prompt` | Sync prompt |
| POST | `/session/:id/promptAsync` | Async prompt (via TaskQueue) |
| POST | `/session/:id/command` | Execute slash command |
| POST | `/session/:id/shell` | Execute shell |
| GET | `/session/:id/messages` | Messages |
| POST | `/session/:id/share` | Create share link |
| POST | `/session/:id/summarize` | Summarize |
| POST | `/session/:id/compact` | Compact context |

### File

`src/server/routes/file.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/find?pattern=<regex>` | ripgrep search (≤10 results) |
| GET | `/find/file?query=<glob>&type=<file\|directory>&limit=<n>` | Filename match (default 10, ≤200) |
| GET | `/find/symbol?query=<q>` | LSP symbol search (currently empty) |
| GET | `/file?path=<p>` | Directory listing |
| GET | `/file/content?path=<p>` | File content |
| GET | `/file/status` | Git status |

### Attachment / Channel

| Method | Path | Purpose |
|---|---|---|
| GET | `/attachment/:projectID/:name` | Task attachment (Content-Type by extension, `Cache-Control: public, max-age=31536000, immutable`) |
| GET | `/channel` | Channel integrations list |
| POST | `/channel/attachment` | Create temp channel attachment → signed URL |
| GET | `/channel/attachment/:id` | Read temp attachment |
| POST | `/channel/message` | Bridge channel message into task board |
| GET | `/channel/runtime` | channel-runtime status |
| POST | `/channel/runtime/restart` | Restart channel-runtime |

### MCP

`src/server/routes/mcp-*.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/mcp` | All MCP server statuses |
| POST | `/mcp` | Dynamically add MCP server |
| POST | `/mcp/:name/auth` | Start OAuth, return authorization URL |
| POST | `/mcp/:name/auth/callback` | Complete OAuth (submit code) |
| POST | `/mcp/:name/auth/authenticate` | Start OAuth & wait for callback (opens browser) |
| DELETE | `/mcp/:name/auth` | Clear OAuth credentials |
| POST | `/mcp/:name/connect` / `/disconnect` | Connect / disconnect |

### Executor

`src/server/routes/executor.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/executor` | All executors with availability and discovery |
| GET | `/executor/:id/model` | Get active LLM |
| PATCH | `/executor/:id/model` | Set LLM; body `{model?}`; 404 if executor doesn't support switching |

### Skill

`src/server/routes/skill.ts`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/skill` | All skills |
| GET | `/skill/installed` | Installed (with source + policy) |
| GET | `/skill/market` | Marketplace entries |
| GET | `/skill/directories` | Config, installed, remote cache dirs |
| POST | `/skill/install` | Install from local / URL / Git |
| POST | `/skill/remove` | Remove |
| POST | `/skill/policy` | Set global allow/ask/deny policy |

### PTY / Trace / Export / TUI / Panel

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/pty` | List / create |
| GET/PUT/DELETE | `/pty/:id` | Detail / update / delete |
| GET | `/pty/:id/connect` | **WebSocket** real-time PTY (needs `Upgrade: websocket`) |
| GET | `/trace` | Task trace IDs |
| GET | `/trace/:taskID` | Trace history |
| GET | `/trace/:taskID/stream` | **SSE trace stream** (replay + live, 15s heartbeat) |
| GET | `/export/task/:taskID` | Export complete task data |
| GET | `/export/session/:sessionID` | Export session |
| POST | `/tui/runtime/start` | Start / connect TUI subprocess |
| GET | `/tui/runtime/status` | TUI runtime status |
| POST | `/tui/runtime/stop` | Stop |
| POST | `/tui/runtime/submit-task` | Submit a task; optionally wait |
| POST | `/tui/runtime/proxy` | Proxy request to TUI |
| POST | `/tui/runtime/task-status` | Query queued task status by taskID |
| GET | `/panel/capabilities` | Panel capability query |
| POST | `/panel/message` | Control message (sync) |
| POST | `/panel/message/stream` | Control message (SSE stream) |
| GET/POST/DELETE | `/panel/knowledge/memory[/...]` | Memory management and search |

The full list (including `/experimental/*`, `/coding/*`, `/gateway/*`) lives in `packages/opencorvus/src/server/routes/`. Only the stable set is listed here.

## SSE event schema

All events are JSON strings in the SSE frame's `data` field.

### System & config

| Event | Payload | When |
|---|---|---|
| `server.connected` | `{}` | SSE connection open |
| `server.heartbeat` | `{}` | Every 10 s |
| `server.instance.disposed` | `{ directory }` | Instance disposed (stream closes after) |
| `global.disposed` | `{}` | After `POST /global/dispose` |
| `config.changed` | Merged Config | After `PATCH /config` or `PATCH /global/config` |

Sources: `src/bus/index.ts:13`, `src/server/event.ts:5`, `src/config/config.ts:1414`

### Session

| Event | When |
|---|---|
| `session.created` / `session.updated` / `session.deleted` | Lifecycle |
| `session.diff` | File changes produced |
| `session.error` | Error inside session |
| `session.status` | `idle` / `busy` / `retry` |
| `session.idle` | Transitioned to idle |

Source: `src/session/index.ts:191`, `src/session/status.ts:28`

### Messages

| Event | When |
|---|---|
| `message.updated` | Created or updated |
| `message.removed` | Deleted |
| `message.part.updated` | Part created / updated |
| `message.part.delta` | Streaming delta (`field` + `delta`) |
| `message.part.removed` | Part deleted |

Source: `src/session/message.ts:451`

### Permission / Question

| Event | When |
|---|---|
| `permission.asked` | AI requests permission |
| `permission.replied` | `once` / `always` / `reject` |
| `question.asked` | AI initiates Q&A |
| `question.replied` / `question.rejected` | Answered / rejected |

Sources: `src/permission/next.ts:119`, `src/question/index.ts:65`

### Task / Orchestrator

The `orchestrator.` prefix is stripped before delivery:

| Event | When |
|---|---|
| `task.created` / `task.updated` / `task.message` | Lifecycle |
| `task.connected` / `task.heartbeat` | SSE handshake / 10s keepalive |
| `spec.created` / `spec.updated` / `spec.approved` | Spec phase |
| `plan.created` / `plan.activated` | Plan version |
| `goal.progress` / `goal.passed` / `goal.failed` | Goal lifecycle |
| `goal.workflow.progress` | Goal workflow steps |
| `milestone.activated` / `milestone.passed` / `milestone.failed` | Milestones |
| `run.created` / `run.updated` / `run.progress` / `run.output` | Run lifecycle |
| `interaction.requested` / `interaction.resolved` | Human-in-the-loop |
| `delivery.ready` | Delivery ready |
| `evaluation.completed` | Evaluation done (verdict in payload) |
| `agent.updated` | Agent internal stage (tool-call start/end) |
| `workflow.selected` / `workflow.step.updated` | Workflow |
| `requirements.completed` / `architect.completed` | Requirements / architecture phase done |

Source: `src/orchestrator/model.ts:810`

### Task list (`/task/events`)

| Event | Payload |
|---|---|
| `task-list.connected` | `{ type, taskID: null, sequence: 0 }` |
| `task-list.heartbeat` | Every 10 s |
| _any task aggregate event_ | `{ type, taskID, sequence }` |

### PTY / MCP / misc

| Event | When |
|---|---|
| `pty.created` / `pty.updated` / `pty.exited` / `pty.deleted` | PTY lifecycle |
| `mcp.tools_changed` / `mcp.prompts_changed` / `mcp.resources_changed` | MCP server change |
| `mcp.browser_open_failed` | OAuth browser open fail |
| `file.edited` / `file.watcher.updated` | Filesystem |
| `project.updated` | Project properties |
| `vcs.branch_updated` | Git branch switch |
| `lsp.updated` | LSP state |
| `session.compaction.compacted` | Compaction done |
| `installation.updated` / `installation.update_available` | Installation |
| `task-queue.completed` | Async prompt done |
| `trace.event` | Trace record |

## Error format

| HTTP | Case |
|---|---|
| 400 | Validation failed |
| 404 | `{ name, data: { message } }` (NamedError) |
| 409 | Active executor session prevents dispose |
| 500 | `{ name: "Unknown", data: { message } }` |
| 503 | Planner failed (`POST /task` or `/task/:id/replan`) |

Sources: `src/server/server.ts:47`, `src/server/error.ts`
