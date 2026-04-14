# HTTP API 参考

本文按路由模块列出 `opencorvus serve` 暴露的所有 HTTP 端点与 SSE 事件。路由注册入口 `packages/opencorvus/src/server/app.ts` + `server.ts`。

## 认证

所有端点受 `OPENCORVUS_SERVER_PASSWORD` 保护。若设置该环境变量，客户端需提供 HTTP Basic Auth（无用户名，密码为环境变量值）。

## 端点总览（按模块）

### Global

| Method | Path | 说明 |
|---|---|---|
| GET | `/global/health` | 健康检查 |
| GET | `/event` | SSE 主事件流 |
| PATCH | `/global/config` | 更新全局配置（emit `config.changed`） |
| POST | `/global/dispose` | 关闭实例（emit `global.disposed` 后断流） |

来源：`src/server/routes/global.ts`

### Task / Orchestrator

核心业务路由，`src/server/routes/orchestrator.ts`：

| Method | Path | 说明 |
|---|---|---|
| POST | `/task` | 创建任务；503 表示 planner 失败 |
| GET | `/tasks` | 列出任务 |
| GET | `/task/:id` | 任务详情 |
| GET | `/task/:id/board` | Kanban 视图 |
| GET | `/task/:id/progress` | 进度聚合 |
| GET | `/task/:id/brief` | 简要汇总 |
| GET | `/task/:id/transcript` | 对话记录 |
| GET | `/task/:id/runs` | run 列表 |
| GET | `/task/:id/interactions` | 交互历史 |
| GET | `/task/:id/events` | **SSE 任务详情流**（`?after=<sequence>` 断点续传） |
| POST | `/task/:id/message` | 追加 follow-up 消息 |
| POST | `/task/:id/inject` | 向执行中 session 注入消息 |
| POST | `/task/:id/retry` | 同 plan 重试 |
| POST | `/task/:id/replan` | 新 plan 版本；503=planner failure |
| POST | `/task/:id/cancel` | 取消任务 |
| GET | `/task/events` | **SSE 任务列表变更通知**（所有任务聚合） |
| GET | `/run/:id` | run 详情 |
| GET | `/run/:id/executor` | run 的 executor 状态 |
| POST | `/interaction/:id/reject` | 拒绝交互请求 |
| PATCH | `/goal/:id` | 更新 goal 描述与验收标准 |
| DELETE | `/goal/:id` | 删除 goal |

### Session

`src/server/routes/session-*.ts`：

| Method | Path | 说明 |
|---|---|---|
| GET | `/session` | 列出 session |
| POST | `/session` | 创建 session |
| GET | `/session/:id` | session 详情 |
| DELETE | `/session/:id` | 删除 session |
| POST | `/session/:id/prompt` | 同步 prompt |
| POST | `/session/:id/promptAsync` | 异步 prompt（通过 TaskQueue） |
| POST | `/session/:id/command` | 执行 slash command |
| POST | `/session/:id/shell` | 执行 shell |
| GET | `/session/:id/messages` | 消息列表 |
| POST | `/session/:id/share` | 生成 share 链接 |
| POST | `/session/:id/summarize` | 总结 session |
| POST | `/session/:id/compact` | 压缩上下文 |

### File

`src/server/routes/file.ts`：

| Method | Path | 说明 |
|---|---|---|
| GET | `/find?pattern=<regex>` | ripgrep 搜索（≤10 结果） |
| GET | `/find/file?query=<glob>&type=<file\|directory>&limit=<n>` | 文件名匹配（默认 10，≤200） |
| GET | `/find/symbol?query=<q>` | LSP 符号搜索（当前返回空） |
| GET | `/file?path=<p>` | 目录列表 |
| GET | `/file/content?path=<p>` | 文件内容 |
| GET | `/file/status` | git 状态 |

### Attachment / Channel

| Method | Path | 说明 |
|---|---|---|
| GET | `/attachment/:projectID/:name` | 任务附件（Content-Type 按扩展推断，`Cache-Control: public, max-age=31536000, immutable`） |
| GET | `/channel` | channel 集成列表 |
| POST | `/channel/attachment` | 创建临时 channel 附件，返回签名 URL |
| GET | `/channel/attachment/:id` | 读取临时附件 |
| POST | `/channel/message` | 从外部 channel 注入消息 |
| GET | `/channel/runtime` | channel-runtime 状态 |
| POST | `/channel/runtime/restart` | 重启 channel-runtime |

### MCP

`src/server/routes/mcp-*.ts`：

| Method | Path | 说明 |
|---|---|---|
| GET | `/mcp` | 所有 MCP server 状态 |
| POST | `/mcp` | 动态添加 MCP server |
| POST | `/mcp/:name/auth` | 启动 OAuth，返回 authorization URL |
| POST | `/mcp/:name/auth/callback` | 完成 OAuth（提交 code） |
| POST | `/mcp/:name/auth/authenticate` | 启 OAuth 流并等待回调（打开浏览器） |
| DELETE | `/mcp/:name/auth` | 清除 OAuth 凭据 |
| POST | `/mcp/:name/connect` | 连接 |
| POST | `/mcp/:name/disconnect` | 断开 |

### Executor

`src/server/routes/executor.ts`：

| Method | Path | 说明 |
|---|---|---|
| GET | `/executor` | 所有 executor 的可用性与发现状态 |
| GET | `/executor/:id/model` | 获取 executor 的活跃 LLM |
| PATCH | `/executor/:id/model` | 设置 executor LLM；body `{model?}`；404 表示 executor 不支持切换 |

### Skill

`src/server/routes/skill.ts`：

| Method | Path | 说明 |
|---|---|---|
| GET | `/skill` | 全部 skill |
| GET | `/skill/installed` | 已安装 skill（含来源与权限） |
| GET | `/skill/market` | 市场条目 |
| GET | `/skill/directories` | 全局、installed、remote cache 目录 |
| POST | `/skill/install` | 从本地/URL/Git 安装 |
| POST | `/skill/remove` | 移除 |
| POST | `/skill/policy` | 设置全局 allow/ask/deny 策略 |

### PTY / Trace / Export / TUI / Panel

| Method | Path | 说明 |
|---|---|---|
| GET/POST | `/pty` | PTY 列表 / 创建 |
| GET/PUT/DELETE | `/pty/:id` | PTY 单项 |
| GET | `/pty/:id/connect` | **WebSocket** 实时 PTY 交互（需 `Upgrade: websocket`） |
| GET | `/trace` | 任务 trace id 列表 |
| GET | `/trace/:taskID` | 任务 trace 历史 |
| GET | `/trace/:taskID/stream` | **SSE 任务 trace 流**（历史回放 + 实时推送，15s 心跳） |
| GET | `/export/task/:taskID` | 导出完整任务数据 |
| GET | `/export/session/:sessionID` | 导出 session |
| POST | `/tui/runtime/start` | 启动 / 连接 TUI 子进程 |
| GET | `/tui/runtime/status` | TUI 运行状态 |
| POST | `/tui/runtime/stop` | 停止 |
| POST | `/tui/runtime/submit-task` | 通过 session API 提交任务，可 wait |
| POST | `/tui/runtime/proxy` | 代理请求到 TUI |
| POST | `/tui/runtime/task-status` | 按 taskID 查询队列状态 |
| GET | `/panel/capabilities` | 控制面板能力查询 |
| POST | `/panel/message` | 控制消息（同步） |
| POST | `/panel/message/stream` | 控制消息（SSE 流） |
| GET/POST/DELETE | `/panel/knowledge/memory[/...]` | Memory 管理与搜索 |

完整清单（含 `/experimental/*`、`/coding/*`、`/gateway/*` 等）请查阅源码 `packages/opencorvus/src/server/routes/`——本文仅列稳定集。

## SSE 事件 schema

所有事件以 JSON 字符串放在 SSE 帧的 `data` 字段。

### 系统与配置

| 事件 | payload | 触发 |
|---|---|---|
| `server.connected` | `{}` | SSE 连接建立 |
| `server.heartbeat` | `{}` | 每 10 秒 |
| `server.instance.disposed` | `{ directory }` | 实例被释放（后断流） |
| `global.disposed` | `{}` | `POST /global/dispose` 后 |
| `config.changed` | 合并后的 Config | `PATCH /config` 或 `PATCH /global/config` 后 |

来源：`src/bus/index.ts:13`、`src/server/event.ts:5`、`src/config/config.ts:1414`

### Session

| 事件 | 触发 |
|---|---|
| `session.created` / `session.updated` / `session.deleted` | 生命周期 |
| `session.diff` | session 产生文件变更 |
| `session.error` | session 内错误 |
| `session.status` | 状态 `idle` / `busy` / `retry` 变化 |
| `session.idle` | 转 idle |

来源：`src/session/index.ts:191`、`src/session/status.ts:28`

### Message

| 事件 | 触发 |
|---|---|
| `message.updated` | message 创建或完成 |
| `message.removed` | 删除 |
| `message.part.updated` | part 创建/更新（tool call、result、step） |
| `message.part.delta` | 流式增量（`field` + `delta`） |
| `message.part.removed` | part 删除 |

来源：`src/session/message.ts:451`

### Permission / Question

| 事件 | 触发 |
|---|---|
| `permission.asked` | AI 请求权限（含 toolName、input、callID） |
| `permission.replied` | `once` / `always` / `reject` |
| `question.asked` | AI 发起 Q&A |
| `question.replied` / `question.rejected` | 回答 / 拒绝 |

来源：`src/permission/next.ts:119`、`src/question/index.ts:65`

### Task / Orchestrator（`/task/:id/events` 与主流中皆推送）

前缀 `orchestrator.` 在发送前会被剥离，示例：

| 事件 | 触发 |
|---|---|
| `task.created` / `task.updated` / `task.message` | 任务生命周期 |
| `task.connected` / `task.heartbeat` | SSE 连接 / 10s 心跳 |
| `spec.created` / `spec.updated` / `spec.approved` | 规格阶段 |
| `plan.created` / `plan.activated` | 计划版本 |
| `goal.progress` / `goal.passed` / `goal.failed` | goal 生命周期 |
| `goal.workflow.progress` | goal 工作流步骤 |
| `milestone.activated` / `milestone.passed` / `milestone.failed` | 里程碑 |
| `run.created` / `run.updated` / `run.progress` / `run.output` | run 生命周期 |
| `interaction.requested` / `interaction.resolved` | 需要人工响应 |
| `delivery.ready` | 交付物就绪 |
| `evaluation.completed` | 评估完成（含 verdict） |
| `agent.updated` | agent 内部阶段（工具调用 start/end） |
| `workflow.selected` / `workflow.step.updated` | 工作流 |
| `requirements.completed` / `architect.completed` | 需求/架构阶段完成 |

来源：`src/orchestrator/model.ts:810`

### 任务列表变更（`/task/events`）

| 事件 | payload |
|---|---|
| `task-list.connected` | `{ type, taskID: null, sequence: 0 }` |
| `task-list.heartbeat` | 每 10s |
| _任意 task 聚合事件_ | `{ type, taskID, sequence }` |

### PTY / MCP / 其他

| 事件 | 触发 |
|---|---|
| `pty.created` / `pty.updated` / `pty.exited` / `pty.deleted` | PTY 生命周期 |
| `mcp.tools_changed` / `mcp.prompts_changed` / `mcp.resources_changed` | MCP server 变更推送 |
| `mcp.browser_open_failed` | OAuth 浏览器打开失败 |
| `file.edited` / `file.watcher.updated` | 文件变更 |
| `project.updated` | 项目属性更新 |
| `vcs.branch_updated` | 分支切换 |
| `lsp.updated` | LSP 状态 |
| `session.compaction.compacted` | session 压缩完成 |
| `installation.updated` / `installation.update_available` | 安装信息 |
| `task-queue.completed` | 异步 prompt 任务完成 |
| `trace.event` | trace 记录 |

## 错误格式

| HTTP | 场景 |
|---|---|
| 400 | 入参校验失败 |
| 404 | `{ name, data: { message } }`（NamedError） |
| 409 | 有活跃 executor session，无法 dispose |
| 500 | `{ name: "Unknown", data: { message } }` |
| 503 | planner 失败（`POST /task` 或 `/task/:id/replan`） |

来源：`src/server/server.ts:47`、`src/server/error.ts`
