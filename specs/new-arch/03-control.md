# 03 — 控制面与消息路由

> 对应代码：`src/channel/` · `src/control/` · `src/panel/capability.ts` ·
> `src/bus/` · `src/trace/` · `src/workspace/` · `src/server/`

## 设计原则

1. **消息直达**。外部消息进入 channel 后不经过无关 LLM 二次推理，直接路由到目标 task session（若该 session 有 pending interaction，确定性回填）。
2. **对话层只产出白名单 action**。`ControlMessage` 是对话层 LLM 入口，但不给它自由 tool 集合；它的输出必须匹配 `PanelCapabilityRegistry` 中的 capability schema（`create_task` / `send_task_message` / `reply_interaction` / `cancel_task` / …）。系统执行 action 时走既有 `EngineService` / `Session` API。
3. **control ≠ workspace**。`control/` 是外部控制账号 + timeline；`workspace/` 是多工作区代理层。命名易混，注意区分。

## 入站路径总览

```
 外部渠道                                      本地用户
 (Slack, HTTP, 自建 bot)                       (overlay, CLI)
        │                                           │
        ▼                                           ▼
 ┌────────────────────────┐              ┌────────────────────────┐
 │ ChannelIngress.message │              │  ControlMessage.handle │
 │ channel/ingress.ts     │              │  control/message.ts    │
 │                        │              │                        │
 │ - ChannelId 校验       │              │  Agent.defaultAgent +  │
 │ - task_id 绑定查找     │              │  PanelCapability 白名单│
 │   (engine_channel_     │              │                        │
 │    binding)            │              │  产出一个或多个 JSON   │
 │ - 有 pending 交互 →    │              │  action                │
 │   确定性 reply_        │              │    create_task         │
 │   interaction          │              │    send_task_message   │
 │ - 否则 → Control       │              │    reply_interaction   │
 │   Message.handle       │              │    cancel_task …       │
 │                        │              │                        │
 └───────────┬────────────┘              └───────────┬────────────┘
             │                                       │
             └───────────────┬───────────────────────┘
                             ▼
                  EngineService (task-api/index.ts)
                  createTask / handleTaskMessage / replyInteraction /
                  cancelTask / retryTask / …
```

### 两个入站入口的分工

| 入口                       | 场景                                                         | 是否过 LLM                                                         |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| **ChannelIngress.message** | 外部 bot / HTTP webhook；消息已有明确语义（reply / 新 task） | 否（确定性路由）；若无 pending interaction 则委托给 ControlMessage |
| **ControlMessage.handle**  | 用户自然语言对话（panel / slack / local）                    | 是（一次 LLM 推理 → 若干 capability action）                       |

两者最终都调 `EngineService.createTask` 或 `Session` / `Question` 等既有 API。

## 对话层 — ControlMessage + Panel Capability

**代码**：`src/control/message.ts` · `src/panel/capability.ts`

旧 Gateway Agent / `channel_key` / `session_gateway_singleton_idx` **全部删除**。对话层统一由 `ControlMessage` 承担。

> 注：`src/gateway/` 目录**未整删**，残留 3 个文件（`session.ts` / `cwd-state.ts` / `tools.ts`），承担"SDK gateway 客户端"轻量职责（按 `metadata.gateway.channelKey` 维护一个 SDK 侧的 gateway session，提供 `enqueue_task` / `forward_clarification` / `switch_cwd` / `cancel_task` 等工具）。它和 `ControlMessage` 是两个独立入口，不重叠。

- 每次 `ControlMessage.handle()` 启动（或复用）一个 `control` session（非 `engine_task`）
- 使用通用 `Agent.defaultAgent()` + 注入 `PanelCapabilityRegistry` 为白名单
- LLM 输出必须是一个或多个 capability action JSON，系统按 action 类型路由
- 支持流式 `ControlMessage.handleStream`（SSE，overlay 实时消费）
- `surface` 区分入口：`panel` · `gateway` · `ChannelId` 枚举（Slack、Telegram、Discord 等，见 `channel/catalog.ts` / `packages/channel-config/src/index.ts`）

**完整 Capability 列表**（来源：`panel/capability.ts`，2026-05-11 共 20 个 action，按文件顺序）：

| 类别             | actions                                                                            |
| ---------------- | ---------------------------------------------------------------------------------- |
| 查询视图         | `view_plan` · `view_board` · `view_tasks`                                          |
| Task 生命周期    | `create_task` · `send_task_message` · `retry_task` · `replan_task` · `cancel_task` |
| Interaction 回复 | `reply_interaction` · `reject_interaction`                                         |
| Goal / Checks    | `update_checks` · `update_goal` · `delete_goal`                                    |
| 视觉证据         | `capture_overlay_screenshot`                                                       |
| Executor / 选择  | `set_executor` · `select_task` · `select_session`                                  |
| Session 操作     | `create_session` · `fork_session` · `delete_session`                               |

> `PanelLocalActionType`（前端 only，不属于 capability registry）当前是 `set_executor` /
> `select_task` / `select_session` / `invalidate_session` 四个；其中 `invalidate_session`
> **只**是 local action 类型，没有对应的 mutation capability，请勿当作可向后端发送的 action。
> 历史版本提到的 `export_session_html` 现仍未注册。

## channel 子系统

**代码**：`src/channel/`

| 文件                           | 作用                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `ingress.ts`                   | `ChannelIngress.message()` 入口；绑定查找；`panel_response` 回复；委托 ControlMessage |
| `catalog.ts`                   | `ChannelId` / `ChannelSurface` 枚举                                                   |
| `registry.ts`                  | channel 注册表                                                                        |
| `supervisor.ts`                | channel runtime 子进程生命周期管理                                                    |
| `slack.ts` + `slack-config.ts` | Slack 适配                                                                            |
| `attachment.ts`                | 附件处理                                                                              |

`engine_channel_binding` 表在 `engine/engine.sql.ts` 定义，记录 `(platform, channel, thread) ↔ task_id` 绑定关系。

## workspace —— 多工作区代理

**代码**：`src/workspace/`

| 文件                                | 作用                            |
| ----------------------------------- | ------------------------------- |
| `workspace.ts` + `workspace.sql.ts` | `workspace` 表 + 多工作区元数据 |
| `config.ts`                         | workspace 配置读写              |

**已删除的旧 control-plane 结构**（旧文档残留）：

- ~~`control-plane/workspace-server/`~~
- ~~`control-plane/session-proxy-middleware.ts`~~
- ~~`control-plane/adaptors/`~~
- ~~`control-plane/config.ts`~~
- `control-plane/sse.ts` → `util/sse.ts`
- `control-plane/workspace.ts` → `workspace/workspace.ts`

多工作区的代理 / SSE 透传不再需要单独一层 server，统一由 `src/server/` 承载路由。

## control —— 外部控制账号

**代码**：`src/control/`

| 文件                | 作用                                                          |
| ------------------- | ------------------------------------------------------------- |
| `control.sql.ts`    | `control_account` + `control_message` 表                      |
| `message-schema.ts` | 入站消息 schema（ControlMessageInput / ControlMessageResult） |
| `message.ts`        | `ControlMessage.handle` / `handleStream` — 对话层入口         |
| `timeline.ts`       | timeline 视图                                                 |

`ChannelIngressResult = ControlMessageResult` — ingress 直接复用 control 的 result schema。

## Bus — 全局事件总线

**代码**：`src/bus/`

- `bus-event.ts` — 类型安全事件定义
- `global.ts` — 全局实例
- `index.ts` — 公共导出

所有横切事件（task 状态变更、workspace ready/failed、trace 事件、config.changed）统一走 Bus。
SSE 消费者订阅 Bus → overlay 实时刷新。事件定义集中在 `engine/model.ts` 的 `Event.*`。

## Trace — 追踪横切

见 [02-data.md #Trace](02-data.md) — 此处不重复。
简言之：`AgentTrace.record*` → JSONL + Bus 双写。

## server/ — HTTP 路由

**代码**：`src/server/`

- 承载 overlay / CLI / 外部 bot 的 HTTP API
- 关键路由（`src/server/routes/` 共 28 个文件，2026-06-17）：
  - `routes/channel.ts` — `ChannelIngress.message` HTTP 端点
  - `routes/panel.ts` — `ControlMessage.handle` / `handleStream`（含 panel SSE 流）
  - `routes/orchestrator.ts` — EngineService.createTask 等 task API（共 42 个 describeRoute；含 task-list change stream 与 task event stream 两条 SSE 主线）
  - `routes/session.ts` — session mutation
  - `routes/control.ts` · `routes/executor.ts` — 控制平面（外部账号 / executor profile）
  - `routes/permission.ts` · `routes/project.ts` · `routes/config.ts` · `routes/question.ts` ·
    `routes/provider.ts` · `routes/mcp.ts` · `routes/file.ts` · `routes/skill.ts` ·
    `routes/browser-preview.ts` · `routes/terminal.ts` · `routes/pty.ts` ·
    `routes/gateway.ts` · `routes/global.ts` · `routes/app.ts` · `routes/attachment.ts` ·
    `routes/auth.ts` · `routes/coding.ts` · `routes/documentation.ts` · `routes/mission.ts` ·
    `routes/plugin.ts` · `routes/experimental.ts` · `routes/export.ts`
- **SSE 端点**：分散在 5 个 route 文件——`routes/orchestrator.ts`（task / task event 双流，主线）·
  `routes/panel.ts`（control stream）· `routes/global.ts` · `routes/app.ts` · `routes/coding.ts`。
  `src/server/event.ts` **不是** SSE 端点，只是一个 7 行的 BusEvent 类型声明文件（`server.connected` / `global.disposed`）。历史文档中"`routes/task-event.ts`"路径不存在；该角色已并入 `routes/orchestrator.ts`。

## 关键文件一览

```
channel/ingress.ts              入站确定性路由
control/message.ts              对话层 LLM + capability 路由
panel/capability.ts             对话层 action 白名单
task-api/index.ts               EngineService（task / session / interaction API）
session/session.sql.ts          session 表（已无 channel_key / gateway 索引）
workspace/workspace.ts          多工作区
control/control.sql.ts          外部账号 + control_message
bus/bus-event.ts                事件总线
trace/index.ts                  JSONL + Bus 双写
server/event.ts                 BusEvent 类型声明（`server.connected` / `global.disposed`，**不是** SSE 端点）
server/routes/orchestrator.ts   task / task event SSE 主线（`streamSSE`）
server/routes/panel.ts          ControlMessage HTTP 入口 + control stream SSE
```

## 相关文档

- [01-agents.md](01-agents.md) — 进入 EngineService 之后的 Task Control Loop
- [04-extensions.md](04-extensions.md) — channel 类型与 ACP/MCP/plugin 的边界
