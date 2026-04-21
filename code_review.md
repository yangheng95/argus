# 结论：接口哲学严重不一致，暂不具备固定协议的条件

5 个 agent 并行审计后，可以明确回答：**当前 opencorvus 对内/对外接口处于多代际堆叠、职责相互渗透的状态**，现在就写 API 文档等于把技术债固化成契约。必须先做 6 项结构清理。

---

## 一、结构性矛盾（必须先解决）

### 1. **没有稳定契约层**（最核心）

`task-api/index.ts` 是实际门面，却把 session（LLM 对话）、engine（状态）、orchestrator（决策）三层职责混在一个 `EngineService` 里。`createTask` 同时做会话创建、任务入库、loop 触发；`cancelTask` 直接 `Orchestrator.abort`；orchestrator 反向依赖 engine store——依赖环没法作为对外稳定层暴露。

- 证据：`task-api/index.ts:409-544、897-900、1003-1055`；`orchestrator/agent.ts:51、69`

### 2. **ID 与字段命名三套并存**

同一实体在不同层用 snake_case（DB）、camelCase（EventView/API）、混合（BusEvent）。store.ts 甚至需要 `executorSessionID ?? executor_session_id` 双路径 fallback，证明曾发生重命名但未完成迁移。`id/id.ts` 定义 48 种 ID 前缀无命名规范文档。

- 证据：`protocol/store.ts:103`；`engine/model.ts:884、903-911`；`protocol/schema.ts:7` vs `protocol.sql.ts:16`

### 3. **消息流 vs 事件流单一真相源缺失**

`Message.Event`（message.ts:464-502）与 `BusEvent.TaskMessageRecorded`（engine/model.ts:903）重叠；`message.part.delta` 既走 Bus 又走 `ProtocolStore.dispatchEphemeral`。谁是权威源不清楚。协议层新加的 `WorkflowSelected/WorkflowStepUpdated` 在 `ProtocolAggregate` 枚举里根本没有对应 aggregate 类型。

### 4. **DB schema 直接当 API 响应**

`MessageTable.data`、`SessionTable.data` 是整个 `Message.Info` JSON 原样返回前端，无 DTO 层。`task-message-protocol-bridge.ts:96-150` 还要维护 `messageRoleCache` 来补偿 Part 事件遗失的 role，说明序列化边界很脏。改 DB 就破坏 API。

---

## 二、东拼西凑的具体"乱摊子"

### 5. **server/routes 50+ 文件的命名混战**

- session 被拆 5 层嵌套：`session.ts → session-management → session-management-mutate → -mutate-core/-mutate-flow`，还并列 `session-interaction-*`。文件名完全不能反映 URL。
- `tui-*` 9 个文件把 UI 命令队列硬编码成 HTTP API（`tui-control.ts:6-50`），web/mobile 无法复用。
- `experimental-*` 9 个无毕业标准；`experimental-cron-schedule.ts:45` 绕过 service 层直接 `Database.use()` SQL。
- `session-management-share.ts` 名字叫 share 实际做 diff/summarize。
- 错误响应 envelope 三种：`errors()` helper / `{error}` / `throw HTTPException`（`quicknote.ts:62`、`app.ts:99`、`orchestrator.ts:72`）。

### 6. **Tool 契约三套并行、互不通气**

- `tool/tool.ts` 的 `Tool.define`（executor 用，有 registry+permission gate）
- `delivery/tools.ts`、`planner/tools.ts`、`orchestrator/tools.ts` 都直接用 AI SDK `tool()`，无中央注册
- `memory_search` 在 planner 和 delivery 各实现一份，返回格式不同
- 错误形式：`Tool.define` 返回 `{title, output, metadata}`；delivery 返 `"Error: ..."` 字符串；orchestrator 直接 throw
- `panel/capability.ts` 的 Capability Registry 和 `tool/panel.ts` 的 22 个 action schema 无自动同步
- Question 既是 tool call 又是独立 bus event + interaction table（`control/message-schema.ts:30` 的 kind 只有 `interaction` 没有 `question`）

### 7. **对外集成协议各自为政**

MCP/ACP/Channel/Executor/IDE 框架层统一（Hono）但协议各写各的；认证双轨（通用 `auth.ts` + `mcp-auth.ts` OAuth，其他模块无认证痕迹）；只有 Channel 真正做推送，"share" 是命名误导；`trace.ts` 已删留下孤儿 `SessionShareTable`。

---

## 三、在写 API 文档前必须完成的 6 件事（按优先级）

| 优先级 | 动作                                                                                                                       | 判定标准                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| P0     | 定义**单一稳定契约层**（建议：`task-api` 分解为 Query / Command 两族 facade），明确它是对外唯一入口                        | session/orchestrator 不再被 route 直接 import |
| P0     | 制定**命名规范文档**：ID 一律 camelCase（外）/ snake_case（DB）、aggregate 类型枚举完整覆盖所有 BusEvent、建立 DTO 层      | grep 不到双路径 fallback                      |
| P1     | **扁平化 session 路由**：合并 5 层嵌套为 `/session`（query / mutation / interaction 三子资源）                             | 文件名=URL 路径前缀                           |
| P1     | **Tool 统一注册中心**：executor/delivery/planner/orchestrator 全部通过同一个 registry 注册，统一 input/output/error schema | 删除 `memory_search` 的重复实现               |
| P1     | **UI 耦合剥离**：`tui-*` 路由和 `panel.ts` 中 `localOnly` action 迁到 capability 层，HTTP API 设备无关                     | 无 `surface === "panel"` 的 throw             |
| P2     | **统一错误 envelope**、**清理 experimental 毕业/下线**、**删除 `SessionShareTable` 孤儿或重命名**                          | 错误响应仅一种 shape                          |

---

## 四、我的判断

现在直接写 API 文档 → 文档会把三层耦合、三套命名、三种错误形式固化给外部客户端，将来任何一层改动都是 breaking change。**建议按 P0 → P1 顺序先完成结构重建（预计 3-5 个专项 PR），再以 `task-api` 新门面为唯一契约层输出 OpenAPI，其余内部路由（tui/experimental/panel 内部命令）不对外发布。**

要不要我先从 P0 的某一项开始动手？比如先画出 task-api 分解成 Query/Command facade 的具体 API 列表，或者先把 ID 命名规范 + DTO 层跑通？

# opencorvus API 组织重构方案

基于三路研究（本地 opencode 上游源码 + MCP/ACP/Claude Code SDK + OpenHands/Cline 横向对比），给出一份可直接落地的方案。**核心立场：opencode 上游的组织哲学是我们的北极星，ACP/OpenHands 的补充只在上游缺失处引入，绝不搞"第四种范式"**。

---

## 一、为什么以 opencode 上游为基线

本地 `C:/Users/chuan/myhexin-local/opencode/` 的 API 有这些我们丢失的优点：

| 维度         | opencode 上游                                        | argus 现状                                                       | 差距     |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| 路由文件数   | 12 个                                                | 50+ 个                                                           | 4× 膨胀  |
| 核心概念     | Session / Message / Part                             | + Task / Goal / Run / Plan / Channel / Panel + 5 层嵌套          | 概念爆炸 |
| URL 风格     | `/session/:id/message/:id/part/:id` RESTful          | `/session-management-mutate-core` 等文件名即路径                 | 反 REST  |
| 前缀滥用     | 只有 `/experimental` 一个功能分区                    | `tui-*` 9 个、`experimental-*` 9 个、`session-management-*` 5 层 | 失控     |
| TUI 耦合     | TUI 通过 **Bus 事件**解耦（tui.ts 只发事件不写业务） | `tui-control.ts:6-50` 直接 HTTP 队列                             | 硬绑定   |
| Schema → DTO | `Session.fromRow()` 显式转换                         | DB row 原样 `c.json(row)`                                        | 无 DTO   |
| 事件命名     | `session.created` / `message.part.delta` 严格点分    | `server.instance.disposed` 和 `Message.Event.PartUpdated` 混用   | 无约定   |

**结论**：argus 丢掉了上游 80% 的好东西，又没换来对等价值。重构方向 = "回归上游 + 补我们真正新增的那部分"。

---

## 二、最终架构（三层清晰、单一契约层）

```
┌─────────────────────────────────────────────┐
│  Transport 层（传输无关）                    │
│  HTTP / SSE / Stdio / WS — 只做序列化        │
├─────────────────────────────────────────────┤
│  API 契约层（单一稳定契约）                  │
│  /api/v1/*                                   │
│  ├─ session / message / part  （opencode 原生）│
│  ├─ task / run               （argus 新增）  │
│  ├─ interaction              （澄清/审批）   │
│  ├─ tool                     （统一注册）    │
│  ├─ capabilities             （能力协商）    │
│  └─ events                   （SSE 统一出口）│
├─────────────────────────────────────────────┤
│  Domain 层（内部实现，API 不暴露）           │
│  session / engine / orchestrator / planner / │
│  delivery / goal / plan / bus / storage      │
└─────────────────────────────────────────────┘
```

**关键原则**：

- API 层只引用 `domain/*/schema.ts`（DTO），不引用 `*.sql.ts`
- Domain 层任何一个模块都可以重构而不破坏 API
- Transport 换成 WS/gRPC 时，API 契约层一个字不改

---

## 三、资源模型：收敛到 5 个顶层资源

借鉴 opencode Session/Message/Part + OpenHands Event + ACP Interaction 的合集：

```
/session                     ← 对话容器（opencode 原生）
  /:id/message
    /:id/part/:id
  /:id/todo
  /:id/children              ← fork 家族树

/task                        ← argus 新增（长跑任务，对 engine_task 的投影）
  /:id
  /:id/run/:id               ← 任务的一次执行
  /:id/goal                  ← goal_run 隐藏在 task 下作为子资源

/interaction                 ← 澄清/审批/权限统一入口
  /:id                       ← GET/POST reply
  ?filter=pending            ← 替代 question_request / permission_request / tui-control 三条线

/tool                        ← 工具注册 + 调用契约
  /                          ← 列表 + schema
  /:id/call                  ← 调用（可选同步/异步）

/capabilities                ← 能力协商（借鉴 MCP initialize）
  GET → { version, tools, interactions, streaming, ... }

/events                      ← 统一 SSE 事件流（借鉴 OpenHands）
  ?filter=session.*&since=id ← 可过滤、可重放
```

**必须删除的概念层**：

- `session-management-*` 5 层嵌套 → 合并进 `/session`
- `tui-*` 9 个路由 → 删除所有，TUI 走 `/events` SSE + 通用 action（见第七节）
- `experimental-*` → 要么转正到主资源，要么放 `/api/experimental/*`（同一前缀）
- `panel` vs `tui` vs `channel` 三套"前端通道" → 统一为 `surface` header

---

## 四、URL & 命名规范（写进 CONTRIBUTING，违反即拒 PR）

| 规则                         | 正例                                   | 反例                                |
| ---------------------------- | -------------------------------------- | ----------------------------------- |
| URL 路径用 kebab-case        | `/tool-call`                           | `/toolCall`                         |
| 路径参数用 camelCase         | `/session/:sessionID`                  | `/session/:session_id`              |
| Wire JSON 字段一律 camelCase | `{ taskID, goalRunID }`                | `{ task_id, goal_run_id }`          |
| DB 字段一律 snake_case       | `task_id`, `goal_run_id`               | —                                   |
| DB↔API 唯一转换点            | `*/schema.ts` 的 `fromRow()`/`toRow()` | route handler 里手动映射            |
| 资源嵌套最多 3 层            | `/session/:id/message/:id/part/:id`    | `/session-management-mutate-core`   |
| 不允许文件名前缀表语义       | `session.ts` 内部用 `.get()` 表达      | `session-management-mutate-core.ts` |

**ID 命名统一**：所有 ID 在 wire 上叫 `xxxID`（camelCase 结尾大写），消除 `taskId`/`taskID`/`task_id` 三套并存。需要起草 `packages/opencorvus/docs/naming.md` 作为唯一真相源。

---

## 五、事件命名空间（强制约定）

借鉴 opencode + OpenHands，采用四段式：

```
{domain}.{entity}.{action}[.{phase}]

session.created
session.updated
message.part.delta
message.part.updated
task.started
task.completed
task.failed
run.tool.requested
run.tool.completed
interaction.requested
interaction.replied
system.error
```

**规则**：

- 所有事件在 `packages/opencorvus/src/bus/event-registry.ts` 集中声明（单一来源）
- 每个事件带 `version: 1` 字段（破坏性变更必升版本）
- 每个事件必须有 `correlationId`（关联 request）和可选 `causedBy`（关联上游事件）
- 禁止 `TuiEvent.CommandExecute` 这类前端专属事件出现在 Bus；前端命令走 `/interaction` 或专门的 in-process channel

**事件 envelope 统一**：

```ts
type Event<T> = {
  id: string              // 事件 id，用于重放去重
  type: string            // 点分名
  version: 1
  timestamp: number
  correlationId?: string
  causedBy?: string
  data: T
}
```

---

## 六、统一契约（借鉴 MCP/ACP/OpenHands）

### 6.1 成功响应

opencode 已经做对了：**直接返回资源 JSON，无 envelope**。保留这个。

### 6.2 错误响应（唯一 shape）

```ts
{
  success: false,
  data: null,
  errors: [{ code: string, message: string, path?: string[] }]
}
```

Hono `.onError()` 统一捕获 `NamedError` 映射到 HTTP 状态码。`c.json({error: ...})` / `throw HTTPException` / `errors()` helper 三套全部删除。

### 6.3 Capability 协商（借鉴 MCP initialize）

```
GET /api/v1/capabilities
{
  protocolVersion: "1.0",
  server: { name: "opencorvus", version: "..." },
  capabilities: {
    session: { fork: true, revert: true, share: true },
    task: { retry: true, goal: true, plan: true },
    tool: { streaming: true, permission: true, count: 42 },
    interaction: { types: ["permission", "clarification", "approval"] },
    events: { sse: true, replay: true, filter: true },
    experimental: ["cron", "memory-view", "worktree"]
  }
}
```

客户端启动先拉一次，知道服务端支持什么。避免 TUI/web 各写一套 try-catch 探测。

### 6.4 稳定性分级（写在 OpenAPI）

```ts
describeRoute({
  operationId: "session.create",
  stability: "stable",              // "experimental" | "stable" | "deprecated"
  deprecatedIn: undefined,
  supersededBy: undefined,
  ...
})
```

`/api/experimental/*` 子路径 = 自动标注 experimental。毕业标准：稳定 2 个版本 + 至少一个外部客户端使用 = 搬到主路径。

---

## 七、多端接入：彻底剥离 UI 专属路由

opencode 的 `tui.ts` 模式是答案：**UI 命令 = Bus 事件，不是 HTTP 业务 API**。

```
删除：
  tui-action-dialog.ts    tui-action-event.ts
  tui-control.ts          tui-runtime-lifecycle.ts
  tui-runtime-status.ts   tui-runtime-task.ts
  tui-runtime.ts          tui.ts

替换为单一文件 server/routes/tui.ts（<100 行）：
  POST /tui/action   ← 纯事件发布，发到 Bus
  GET  /tui/next     ← 从 Bus 拉 UI 命令
```

业务 API（`/session/*`、`/task/*`）保持设备无关，TUI / web / overlay / plugin 统一调同一份。

类似地：

- `panel.ts` 的 `localOnly` action 迁到 `/interaction`，把 surface 当 header 传
- `channel/ingress` 独立在 `/api/channel/:name/ingress`，不混进 `/session/*`

---

## 八、Tool 契约统一（关键重构）

**当前**：`tool/tool.ts` 的 `Tool.define` / delivery `tool()` / planner `tool()` / orchestrator `tool()` 四套并存。

**目标**：单一 `ToolRegistry`，所有调用方（executor/delivery/planner/orchestrator/MCP）都从这里拿工具。

```ts
// packages/opencorvus/src/tool/registry.ts（唯一真相源）
type ToolSpec = {
  id: string
  scope: "read" | "write" | "execute"
  surfaces: Array<"executor" | "delivery" | "planner" | "orchestrator" | "mcp">
  input: ZodSchema
  output: ZodSchema
  permission?: PermissionRule
  execute: (params, ctx) => Promise<ToolResult>
}

type ToolResult = {           // 统一返回形状，替代 {title,output,metadata} / "Error:..." / throw
  success: boolean
  title?: string
  output: unknown
  metadata?: Record<string, unknown>
  error?: { code: string, message: string }
}
```

`memory_search` 只定义一次，四个 surface 复用。AI SDK 的 `tool()` 包装成薄 adapter，不是第二份注册中心。

Tool 调用事件化（借鉴 OpenHands）：

```
run.tool.requested   → run.tool.started  → run.tool.progress* → run.tool.completed
                                                              ↘  run.tool.failed
```

---

## 九、Interaction 协议（澄清/审批/权限三合一）

当前三条独立线：`question_request`（澄清）+ `permission_request`（审批）+ `tui-control`（UI 命令）。合并为：

```
POST /api/v1/interaction/:id/reply
GET  /api/v1/interaction?status=pending&surface=tui

type InteractionRequest = {
  id: string
  type: "permission" | "clarification" | "approval" | "local_action"
  message: string
  options?: string[]
  schema?: ZodSchema
  timeoutMs?: number          // default 300000
  requiredSurface?: string    // 只给特定前端显示
  expiresAt: number
}
```

背后统一存 `engine_interaction_request` 表。当前的 `question_request` 子类型、`permission_request` 全部映射到这个 shape。

---

## 十、落地路线（按可独立合并的 PR 切分）

| PR       | 内容                                                                          | 风险         | 前置                  |
| -------- | ----------------------------------------------------------------------------- | ------------ | --------------------- |
| **P0-1** | 起草 `docs/api-naming.md` + `docs/event-taxonomy.md` + `docs/capabilities.md` | 低（纯文档） | —                     |
| **P0-2** | 建 `packages/opencorvus/src/api/schema/` DTO 目录 + `fromRow/toRow` 骨架      | 低           | P0-1                  |
| **P0-3** | 统一错误 envelope，所有 route 用 `errors()` helper，删除三种 shape            | 中           | P0-2                  |
| **P1-1** | 合并 `session-management-*` 5 层为单一 `session.ts`（保留 URL，只挪文件）     | 中           | P0-3                  |
| **P1-2** | 删除 `tui-*` 9 路由，替换为 `/tui/action` + `/tui/next` + Bus 事件            | 高           | P1-1（测试 TUI 不断） |
| **P1-3** | 引入 `ToolRegistry` 统一注册中心；`memory_search` 只留一份                    | 中           | P0-2                  |
| **P1-4** | 合并 `question_request` + `permission_request` 到 `/interaction`              | 中           | P1-3                  |
| **P2-1** | 暴露 `/capabilities` endpoint；路由标注 stability                             | 低           | P1-x 完               |
| **P2-2** | `/events` SSE 统一出口，替代散落的 stream handler                             | 中           | P2-1                  |
| **P2-3** | 删除 `experimental-*` 前缀，全部挪到 `/api/experimental/*` 或毕业             | 低           | P2-2                  |
| **P3**   | 基于稳定 API 产出 OpenAPI spec + 多语言 SDK 生成                              | 低           | 全部                  |

---

## 十一、给自己的硬约束

写代码前先 `diff argus/src/server/routes opencode/src/server/routes`，**每新增一个我们独有的文件，必须在 commit message 里解释"为什么 opencode 上游没有但我们必须有"**。答不上就说明你在制造 argus 的第 51 个路由文件。

---

## 小结（一句话）

**回归 opencode 上游的 Session/Message/Part + RESTful + Bus 骨架；用 ACP 的 capability 协商 + OpenHands 的事件分类法补齐 argus 独有的 Task/Run/Interaction/Tool 扩展；删掉 tui-/experimental-/session-management- 三个失控前缀；建立单一 DTO 层 + 单一 Tool 注册 + 单一 Interaction 协议。**

要不要我先动手 P0-1（起草命名、事件、capability 三份规范文档）？这个最便宜，而且后续所有 PR 都依赖它。

1. 消息卡片 POJO OOP 统一设计原则。每个卡片必有创建时间。
2. Agent设计 OOP 设计原则，
3. 双源设计删除
4. 双入口设计删除
5. 事件命名空间设计原则
6. API 设计统一原则
7. Tool 设计统一原则
8. Interaction 设计统一原则
9. 职责分离设计原则
10. 智能调度设计原则
11. 删除合成消息，拆分助手/用户消息
12. 删除drizzle，改用纯事件驱动设计
