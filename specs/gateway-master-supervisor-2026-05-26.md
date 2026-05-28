# Gateway Master Supervisor — Final Spec

> **SUPERSEDED 2026-05-28** by `gateway-mission-split-2026-05-28.md`. 上层编排概念已从 gateway 基建命名空间拆出，更名为 **Mission**（agent id `mission`、kind `mission`、`/mission/wake`、`.opencorvus/runtime/mission/`）。本文件仅作历史记录保留；当前实现以新 spec 为准。

**Status**: Superseded — see `gateway-mission-split-2026-05-28.md`
**Date**: 2026-05-26
**Supersedes**: `gateway-master-mission-owner-2026-05-26.md`（待用户确认后删除）
**Author**: Claude Code, in conversation with user

---

## 0. TL;DR

新增 `gateway-master` 作为 **hidden primary agent**，走 `SessionWake.wake → SessionPrompt.loop`（与 `coding` 同款 runtime）。工具集**窄到 supervisor 级别**：仅持 mission state I/O + task dispatch + task query + research + memory + todo + question。**不持有任何执行类工具**（无 bash / edit / read / write / glob / webpage_extract / url_screenshot / 完整 panel）。

执行工作（爬取 / 写代码 / 视觉验收）全部派给 build/coding/integrity 子任务，复用现有 orchestrator → stage agents 管线。

同步删除 `/gateway/task/decompose` 全链路死代码（rule 8 + 16）。

**不引入** MissionTable / 新 SessionKind / propose_task mission 继承（codex round 3 明确为可延后项）。

---

## 1. Scope

### In Scope

- 注册 `gateway-master` agent
- 新 tool：`mission_state`（path-confined worktree 文件 I/O）
- 新 panel action：`query_task`（结构化批量查询）
- Panel `actor` provenance 字段（区分 panel_ui / control_agent / gateway_master）
- Panel action whitelist 按 actor 过滤（master 只能 create_task + query_task）
- 路由 `POST /gateway/master/wake`
- 删除 decompose 全链路死代码
- Overlay GatewayComposer 重写为 master 启动入口

### Non-Goals（明确不做）

- 专用 site crawler / anti-bot / cookie-pool / proxy-rotation（rule 5；codex round 3 明确）
- MissionTable / engine_artifact 改造（推迟到验证 markdown 文件方案不够再做）
- 新 SessionKind 枚举值（复用现有方式）
- `propose_task` mission_id 继承（推迟到出现真实需求）
- Mission 全量 UI / dashboard

### 用户目标 vs 本 spec 能力（rule 28b 坦诚）

用户最终目标是"复刻 TradingView 整站"。**本 spec 不能交付该目标**：

- TradingView 官方禁止 scraping / data mining / 绕过保护机制
- DataDome + Cloudflare 是真实反自动化栈
- 现有 `webpage_extract` 设计文档自承"site denied access — provide pre-extracted url-data.json instead"

**本 spec 交付的是 mission supervisor 基础能力**：用户可以用它管理任何"长时间跨任务"研究项目。**TV 复刻的完成度预期 5-15%**（仅 marketing/公开页面），核心 chart/数据流/登录后内容 ~0%。如需进一步推进 TV 复刻，正确路径是合法 widget（Charting Library / Lightweight Charts）+ 官方文档 + 授权数据，不是反爬突破。

---

## 2. 设计

### 2.1 Agent 注册

`packages/opencorvus/src/agent/role-contract.ts` — `AgentRoleID` 增 `"gateway-master"`：

```ts
"gateway-master": {
  id: "gateway-master",
  description: "Mission supervisor primary agent. Owns long-running cross-task research strategy. Dispatches engine_tasks; does not execute work itself.",
  promptEditable: true,
  defaultPromptRequired: true,
  promptConfigMode: "append",
}
```

`packages/opencorvus/src/agent/agent.ts::Agent.state` 注册：

```ts
"gateway-master": {
  name: "gateway-master",
  description: AgentRoleContract.description("gateway-master"),
  prompt: GATEWAY_MASTER_CORE,
  tools: {
    include: [
      "mission_state",   // path-confined worktree file I/O（新增）
      "create_task",     // panel action 拆分或 filter（新增）
      "query_task",      // 结构化批量任务查询（新增）
      "webfetch",
      "websearch",
      "memory",          // registry 的单工具 action 形态
      "todoread",
      "todowrite",
      "question",
    ],
  },
  steps: 1000,
  options: {},
  mode: "primary",
  native: true,
  hidden: true,           // 防 Agent.defaultAgent() 选中顶掉 coding
}
```

**显式不包含**（每一项都是有意的）：
- `bash / edit / read / write / glob / search_code` — 执行类工具；scheduler 拿到必退化（参考 `agent.ts:266-283` orchestrator 注释教训）
- `webpage_extract / url_screenshot` — 爬取/截图能力由 design-analyst 在派出去的 task 内行使
- 完整 `panel` — 太大，含 retry/replan/cancel/send_message/update_goal/session 操作；用 action-filter 收窄
- `propose_task` — orchestrator 的 task 内 follow-up 工具，与 master 跨 mission dispatch 职责正交

`NATIVE_DEFAULTS`（`agent.ts:515`）加 `"gateway-master": GATEWAY_MASTER_CORE`。

### 2.2 `mission_state` 工具（新增）

`packages/opencorvus/src/tool/mission-state.ts`（注册到 `ToolRegistry`）：

```ts
mission_state({
  action: "read" | "write" | "list",
  missionID: string,
  file?: "frontier.md" | "tasks.md" | "handoff.md" | "notes.md",
  content?: string,   // write 时必填
})
```

行为：
- **底层路径硬约束**：`<worktree>/.opencorvus/runtime/gateway-master/<missionID>/<file>`
- `action="list"` 列出该 mission 目录下所有文件 + size + mtime
- `action="read"` 读单文件全文
- `action="write"` 原子替换单文件（temp + rename）
- `missionID` 必须匹配 `/^[a-z0-9-]{1,64}$/`，不允许路径分隔符
- `file` 必须是 union 中的 4 个之一，**不允许任意文件名**
- `content` 必须 ≤256 KB

**为什么是固定 4 个文件**：

- `frontier.md` — 待处理工作清单
- `tasks.md` — 已派任务的 ID + 简短摘要
- `handoff.md` — 跨 wake 给下一个自己的 brief（compaction 风险缓解）
- `notes.md` — 自由 scratchpad

固定文件名 + 固定目录是 rule 9（抽象模式）+ rule 10（禁硬编码任意路径）。

`.gitignore` 加 `.opencorvus/runtime/`。

### 2.3 `query_task` panel action（新增）

`packages/opencorvus/src/panel/capability.ts` 加：

```ts
query_task: {
  kind: "query",
  description: "Structured batch query of task status for LLM reconciliation. Distinct from view_board (human-oriented, single-task, narrative).",
  schema: z.object({
    action: z.literal("query_task"),
    taskIDs: z.array(z.string()).min(1).max(50),
    includeChildren: z.boolean().default(false),
    includeInteractions: z.boolean().default(false),
  }),
}
```

返回：

```ts
{
  tasks: Array<{
    taskID: string
    title: string
    status: "queued" | "active" | "completed" | "failed" | "cancelled"
    error?: string
    created: number
    started?: number
    completed?: number
    evaluation?: { verdict: string; summary: string }
    delivery?: { summary: string }
    children?: string[]
    pendingInteractions?: number
  }>
}
```

实现复用 `EngineService.compileBoard` 数据源。

**为什么不直接用 view_board**：view_board 给人看（单任务、markdown 长文本、上下文重）；query_task 给 LLM reconcile（批量、稳定 JSON、低 token）。两条不同消费场景，**不是 rule 8 双源**——返回形态本质不同。

### 2.4 Panel `actor` provenance（新增字段）

`packages/opencorvus/src/panel/capability.ts` 调用上下文加：

```ts
actor: "panel_ui" | "control_agent" | "gateway_master"
actorSessionID?: string
actorAgent?: string
```

授权 + action 过滤看 `actor`，**不再用自由文本 `source` 做权限判断**。任务 metadata 落 `actor` 字段做审计。

**Action whitelist by actor**：
- `panel_ui`：所有 action（现状）
- `control_agent`：现有 control 路径用的子集（保持现状）
- `gateway_master`：仅 `create_task` + `query_task`

### 2.5 Wake entry

`packages/opencorvus/src/server/routes/gateway.ts` 加：

```ts
POST /gateway/master/wake
body: { missionID?: string, text: string, title?: string }
```

行为：
- 若 `missionID` 缺省：生成新 `missionID`，创建新 gateway session（复用 `ensureGatewaySession` 但改 channelKey 命名 `master:<missionID>`）
- 若 `missionID` 提供：按 `master:<missionID>` channelKey 查找现有 session
- 调用 `SessionWake.wake({ sessionID, prompt: text, agent: "gateway-master" })`

**并发约束**：同一 missionID 同时只允许一个 master loop active。`SessionWake.wake` 内部的 `running` 检查需要保证这点（已存在机制；测试覆盖）。

### 2.6 Worktree state convention（硬约定）

master prompt 强制：
- 每次 wake **第一件事**：`mission_state(action=read, file=handoff.md)` + `mission_state(action=read, file=tasks.md)`
- 任何重大状态变化后**必须**：write handoff.md 把下一步给"下一个 wake 的自己"
- 派 task 后**必须**：append tasks.md 记录 taskID + 简短摘要
- 完成 task 后**必须**：update tasks.md 状态

**compaction 缓解**：master prompt 顶部嵌入"frontier/tasks/handoff 文件存在于 .opencorvus/runtime/gateway-master/<missionID>/"的强提示，避免几天后 compaction 把这条事实丢掉。

### 2.7 Task granularity convention（2026-05-26 补丁，gap fix）

**问题**：本 spec § 2.6 定义了 master 的 I/O contract，但**完全没有约束 task 粒度**。`gateway-master-core.txt` 初版第 27 行只说 "dispatch one or more new tasks"，没有任何合批指导。用户观测到 master 一次 wake fan-out 3 个独立 task。

**根因**：执行链路在 task **内部**已经有完整的 architect 拆 goal 机制（requirements → architect → build → integrity，每段是独立 sub-agent context）。Master 再按 frontier bullet 拆 task，就是**双层拆分**——每个 task 都要新起一个 worktree + 全套 sub-agent bootstrap，把本可共享的工作变成 N 倍 bootstrap 开销。这属于 CLAUDE.md rule 5/6 的"过度工程"——叠加 LLM 不需要的额外分解层。

**修复（rule 6.1 prompt-only）**：在 `gateway-master-core.txt` 新增 "TASK GRANULARITY — batch first, split only with cause" 章节（在 EVERY WAKE 与 DISPATCHING TASKS 之间）。规则：

- **默认**：一次 wake 只发 1 个 task，把所有相关 frontier 项打包进单个自洽 `request`，让 executor 的 architect 阶段去拆 goal。
- **拆分触发器（满足其一才可发多 task）**：① 不同 repo / executor / worktree；② 单项体量已经够一个 task；③ 项之间无共享上下文且并行能显著缩短墙钟时间。
- **反模式**：1 frontier bullet => 1 task **不是**规则；同子系统/同 surface/同调查线的多个 bullet 是 1 个 task 多个 goal。

§ 2.6 的"派 task 后 append tasks.md"约定不变；这里只是收紧"何时算一个 task"。

### 2.8 Overlay 改动

`packages/overlay/src/components/Gateway.tsx` 的 `GatewayComposer`（line 1480-1622）**整块重写**：
- 移除 decompose proposal preview UI
- 改为：输入框 + "Start mission" 按钮 → 调 `POST /gateway/master/wake`（无 missionID → 创建新 mission）→ 跳转/嵌入 master session 视图
- 现有 mission 列表（如果做）按 worktree 目录 `.opencorvus/runtime/gateway-master/` 扫描得到

Overlay 配套：`Avatar.tsx` + `message.ts AgentRole union` + `i18n` 加 `gateway-master` 条目。

---

## 3. 文件清单（rule 35 穷举）

### 新增文件

| 文件 | 内容 |
|---|---|
| `packages/opencorvus/src/prompt/core/gateway-master-core.txt` | master core prompt（含 worktree convention） |
| `packages/opencorvus/src/tool/mission-state.ts` | path-confined 文件工具 |
| `packages/opencorvus/test/tool/mission-state.test.ts` | 工具单测 |
| `packages/opencorvus/test/panel/query-task.test.ts` | query_task action 测试 |
| `packages/opencorvus/test/panel/actor-authorization.test.ts` | actor 字段授权测试 |
| `packages/opencorvus/test/gateway/master-route.test.ts` | wake 路由测试 |

### 修改文件

| 文件 | 修改 |
|---|---|
| `packages/opencorvus/src/agent/role-contract.ts` | 加 `"gateway-master"` 条目 |
| `packages/opencorvus/src/agent/agent.ts` | 注册 agent + `NATIVE_DEFAULTS` |
| `packages/opencorvus/src/panel/capability.ts` | 加 `query_task` action + `actor` 字段 + actor whitelist |
| `packages/opencorvus/src/tool/panel.ts` | actor 检查 + create_task action 暴露给 master |
| `packages/opencorvus/src/server/routes/gateway.ts` | 加 `/master/wake` + 删 `/task/decompose` 路由 |
| `packages/opencorvus/src/gateway/session.ts` | 支持 `master:<missionID>` channelKey 形态 |
| `packages/opencorvus/src/session/session.sql.ts:24-26` | 改写幻觉注释 |
| `packages/overlay/src/components/Gateway.tsx` | 重写 GatewayComposer |
| `packages/overlay/src/components/Avatar.tsx` | 加 gateway-master icon |
| `packages/overlay/src/utils/message.ts` | `AgentRole` union + `normalizeAgentRole` |
| `packages/overlay/src/i18n/zh-CN.json` + `en-US.json` | role label + UI 文案 |
| `packages/overlay/src/services/tree-writer.ts` | gateway-master session 卡片路由 |
| `packages/opencorvus/test/agent/agent.test.ts` | 工具白名单反向断言（无 bash/edit/etc） |
| `packages/opencorvus/test/agent/role-contract.test.ts` | 新角色注册 |
| `.gitignore` | 加 `.opencorvus/runtime/` |
| `docs/product/zh-CN/reference/api.md` + `en/reference/api.md` | wake 端点文档 |
| `docs/product/{en,zh-CN}/concepts/architecture.md` | task lifecycle 描述更新 |

### 删除文件 / 路径

| 文件 | 状态 |
|---|---|
| `packages/opencorvus/src/server/routes/gateway.ts` 中 `/task/decompose` 路由 | 删 |
| `packages/opencorvus/src/gateway/decompose.ts` | 整文件删 |
| `packages/opencorvus/src/gateway/tools.ts` | 整文件删（仅 test 引用，无 src 消费） |
| `packages/opencorvus/src/gateway/cwd-state.ts` | 整文件删（仅服务被删的 switch_cwd） |
| `packages/opencorvus/test/gateway/decompose.test.ts` | 整文件删 |
| `packages/opencorvus/test/gateway/decompose-route-shape.test.ts` | 整文件删 |
| `packages/opencorvus/test/gateway/tools.test.ts` | 整文件删 |
| `packages/opencorvus/test/gateway/session.test.ts` | 整文件删（ensureGatewaySession 现状无 src 消费） |
| `packages/overlay/src/services/gateway.ts` | `decomposeRequirement` + types 删，文件其余保留 |
| `packages/overlay/src/utils/gateway-helpers.ts` | `GATEWAY_REQUIREMENT_MAX_CHARS` + `composeTaskText` 删 |
| `packages/opencorvus/test/gateway/e2e.test.ts` | decompose 相关 case 删 |
| `packages/sdk/openapi.json` + `packages/sdk/js/src/gen/*` | regen 后 decompose 自动消失 |
| 旧 spec `specs/gateway-master-mission-owner-2026-05-26.md` | 待用户确认后删 |

---

## 4. Commit 顺序（codex round 3 给定，无回滚痛苦优先）

1. **作废旧 spec + 落盘新 spec**（本文件）
2. **Panel action filtering + actor provenance**（含测试）
3. **`query_task` panel action**（复用 compileBoard，schema + 工具测试）
4. **`mission_state` 工具**（固定目录 + 文件名 + 原子写 + 读写/并发测试）
5. **注册 `gateway-master` agent**（hidden primary + 窄白名单 + 反向断言测试）
6. **Wake entry**（`/gateway/master/wake` 复用 `SessionWake.wake` + 新建/复用 session 测试）
7. **Overlay rewrite**（GatewayComposer 改成 master 启动流 + UI tests + Avatar/i18n）
8. **Delete decompose chain**（route + decompose.ts + overlay services + gateway/tools.ts + cwd-state.ts + ensureGatewaySession + 测试）
9. **SDK/OpenAPI/docs regen**（确保 `/gateway/task/decompose` 全链路消失；改 architecture.md）
10. **Final verification**（agent / tool registry / panel / gateway route / overlay tests + routes:check + docs:check）

每个 commit 独立 revertable 且含测试。

---

## 5. 测试矩阵（rule 36）

| 行为 | 测试 |
|---|---|
| `gateway-master` 出现在 Agent.list，工具白名单严格 | `test/agent/agent.test.ts` |
| `gateway-master` **不含**任何执行工具（反向断言） | `test/agent/agent.test.ts` |
| `gateway-master` 是 hidden primary，不被 `defaultAgent()` 选中 | `test/agent/agent.test.ts` |
| `mission_state` 拒绝任意 path / 非白名单文件名 | `test/tool/mission-state.test.ts` |
| `mission_state.write` 原子 + 256KB 上限 | `test/tool/mission-state.test.ts` |
| `query_task` 返回结构化 JSON，与 view_board 不同 | `test/panel/query-task.test.ts` |
| `query_task` 50 个 taskID 上限 | `test/panel/query-task.test.ts` |
| `actor=gateway_master` 调 `retry_task` / `cancel_task` 等被拒 | `test/panel/actor-authorization.test.ts` |
| `actor=panel_ui` 不受影响 | `test/panel/actor-authorization.test.ts` |
| `POST /gateway/master/wake` 无 missionID 创建新 mission session | `test/gateway/master-route.test.ts` |
| `POST /gateway/master/wake` 有 missionID 复用现有 session | `test/gateway/master-route.test.ts` |
| `/gateway/task/decompose` 路由删除（404） | `test/gateway/master-route.test.ts` |
| OpenAPI 不再包含 decompose | routes:check / docs:check pre-push hook |

---

## 6. 已知风险

| 风险 | 缓解 |
|---|---|
| Compaction 丢 worktree 文件存在性事实 | master prompt 顶部硬编码"frontier/tasks/handoff 文件在 `<path>`" |
| 多 mission 并发写竞争 | mission_state 原子写 + 同 missionID 同时只允许一个 master loop |
| TV 反爬复刻完成度 5-15% | §1 已对用户坦诚，本 spec 不交付 TV 复刻目标 |
| master 误判 task verdict（query_task 输出歧义） | query_task 返回 status 字段限 5 个 enum + 测试覆盖 |
| `actor` 字段忘记落到 task metadata | actor-authorization 测试断言 metadata 包含 |
| 派出去的 build/coding task 内 LLM 没有 mission 上下文 | master 写 task `request` 时把必要 mission 背景嵌入；不依赖 actor 跨传 |

---

## 7. 未在本 spec 内的下一步（codex 明确可延后）

- 专用 site crawler / anti-bot 能力
- MissionTable + propose_task mission_id 继承（如果 markdown 文件方案验证不够再做）
- Mission dashboard UI
- 多 mission concurrent UI
