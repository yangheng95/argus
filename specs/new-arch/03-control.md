# 03 — 控制面与消息路由

> 对应代码：`src/channel/` · `src/gateway/` · `src/bus/` · `src/trace/` ·
> `src/control/` · `src/control-plane/` · `src/server/` · `src/session/channel-key.ts`

## 设计原则

1. **消息直达**。外部消息进入 channel 后不经过无关 LLM 二次推理，直接路由到目标 task session。
2. **Gateway 只做对话层路由**。业务逻辑在 OrchestratorService / Session / Question 等现有 API。
3. **control-plane ≠ control**。前者是多工作区代理层；后者是外部控制账号。命名易混，注意区分。

## 入站路径总览

```
 外部渠道                                      本地用户
 (Slack, HTTP, 自建 bot)                       (overlay, TUI, CLI)
        │                                           │
        ▼                                           ▼
 ┌────────────────────────┐              ┌────────────────────────┐
 │ ChannelIngress.message │              │  Gateway Agent (LLM)   │
 │ channel/ingress.ts     │              │  gateway/agent.ts      │
 │                        │              │                        │
 │ - ChannelId 校验       │              │  channel_key 单例      │
 │ - task_id 绑定查找     │              │  session_gateway_      │
 │ - 无 task → panel_     │              │   singleton_idx        │
 │   response / 建新      │              │                        │
 │ - 有 pending 交互 →    │              │  工具: list/get/cancel │
 │   确定性 reply         │              │  /enqueue/dispatch     │
 │                        │              │  /forward_clarification│
 │                        │              │  /switch_cwd           │
 └───────────┬────────────┘              └───────────┬────────────┘
             │                                       │
             └───────────────┬───────────────────────┘
                             ▼
                  OrchestratorService.createTask
                  (orchestrator/service.ts)
```

### 两个入站入口的分工

| 入口 | 场景 | 是否过 LLM |
|---|---|---|
| **ChannelIngress** | 外部 bot / HTTP webhook；消息已有明确语义（reply/新 task） | 否（确定性路由） |
| **Gateway Agent** | 用户自然语言对话；需要理解意图（listing vs creating vs cancelling） | 是 |

两者最终都汇入 `OrchestratorService.createTask` 或现有 session API。

## channel_key — Gateway session 单例

**代码**：`src/session/channel-key.ts`

```
ChannelKeyInput =
  | { platform: string; channel: string; userID: string }  // 外部渠道
  | { local: true; userID: string }                         // 本地客户端

channelKey(input) → "platform:channel:userID"
                  | "local:userID"
```

**作用**：
- Gateway session 按 `(platform, channel, user)` 三元组建立单例
- 数据库 partial unique index `session_gateway_singleton_idx` 保证并发安全
- race 冲突 → 捕获异常 → 重读现有 session

**session row**：
- `kind = 'gateway'`
- `channel_key = <上述字符串>`
- `metadata.gateway.cwd = <当前工作目录>`（通过 `switch_cwd` 工具改写）

## channel 子系统

**代码**：`src/channel/`

| 文件 | 作用 |
|---|---|
| `ingress.ts` | `ChannelIngress.message()` 入口；绑定查找；`panel_response` 回复 |
| `catalog.ts` | `ChannelId` 枚举 |
| `registry.ts` | channel 注册表 |
| `supervisor.ts` | channel runtime 子进程生命周期管理 |
| `slack.ts` + `slack-config.ts` | Slack 适配 |
| `attachment.ts` | 附件处理（见旧 SVG Section K） |

## control-plane —— 多工作区代理

**代码**：`src/control-plane/`

| 文件 | 作用 |
|---|---|
| `workspace.ts` + `workspace.sql.ts` | `workspace` 表，多工作区元数据 |
| `workspace-server/` | 每个 workspace 的 HTTP 服务器 |
| `session-proxy-middleware.ts` | SSE 从子 workspace 透传到前台 |
| `adaptors/` | worktree 适配（跑具体代码库） |
| `sse.ts` | SSE 解析 |

用于多工作区场景（一个前台进程代理多个独立的工作目录 / executor）。

## control —— 外部控制账号

**代码**：`src/control/`

| 文件 | 作用 |
|---|---|
| `control.sql.ts` | `control_account` + `control_message` 表 |
| `message-schema.ts` + `message.ts` | 入站消息 schema（复用于 ChannelIngress） |
| `timeline.ts` | timeline 视图 |

外部系统（例如用户自己的 bot）通过 control 账号向 argus 发消息。
`ChannelIngressResult = ControlMessageResult` — ingress 复用 control 的 result schema。

## Bus — 全局事件总线

**代码**：`src/bus/`

- `bus-event.ts` — 类型安全事件定义
- `global.ts` — 全局实例
- `index.ts` — 公共导出

所有横切事件（task 状态变更、workspace ready/failed、trace 事件）统一走 Bus。
SSE 消费者订阅 Bus → overlay 实时刷新。

## Trace — 追踪横切

见 [02-data.md #Trace](02-data.md) — 此处不重复。
简言之：`Trace.event()` → JSONL + Bus 双写。

## server/ — HTTP 路由

**代码**：`src/server/`

- 承载 overlay / CLI / 外部 bot 的 HTTP API
- 包含 `routes/task-event` 等 SSE 路由，消费 Bus

## 关键文件一览

```
channel/ingress.ts              入站确定性路由
gateway/agent.ts                对话层 LLM 路由
session/channel-key.ts          channel_key 派生
session/session.sql.ts          session_gateway_singleton_idx
control-plane/workspace.ts      多工作区
control/message.ts              外部账号消息
bus/bus-event.ts                事件总线
trace/index.ts                  JSONL + Bus 双写
server/routes/task-event.ts     SSE 端点
```

## 相关文档

- [01-agents.md](01-agents.md) — Gateway 之后的 Task Agent 生命周期
- [04-extensions.md](04-extensions.md) — channel 类型与 ACP/MCP/plugin 的边界
