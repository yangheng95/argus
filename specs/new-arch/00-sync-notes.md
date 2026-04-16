# new-arch.svg 同步工作文档

> 目的：把当前 `packages/opencorvus/src/` 的真实架构折叠成三张 mental model，
> 作为后续改 `new-arch.svg`（或拆分 Markdown）的基线。
> 阶段 1 产出（概念对齐），尚未动 SVG。

---

## 图 1 — Agent 家族全景（谁调谁）

```
             ┌─────────────────────────────────┐
  外部渠道 →  │  ChannelIngress.message()      │  channel/ingress.ts
  (Slack/    │  入站路由 · 绑定 task_id         │  → EngineService / ControlMessage
   HTTP/…)   └──────────────┬──────────────────┘
                            │
                            ▼
  本地用户 → ┌─────────────────────────────────┐
             │  Gateway Agent (LLM)            │  gateway/agent.ts
             │  per-channel 单例 session       │  session.channel_key 索引
             │  工具: list/get/cancel/         │  gateway/tools.ts
             │       enqueue/dispatch/         │
             │       forward_clarification/    │
             │       switch_cwd               │
             └──────────────┬──────────────────┘
                            │ createTask(kind)
                            ▼
             ┌─────────────────────────────────┐
             │  EngineService            │  orchestrator/service.ts
             │  → engine_task 行         │
             └──────┬─────────────────┬────────┘
                    │                 │
          kind="workflow"      kind="build"
                    │                 │
                    ▼                 ▼
          ┌──────────────────┐   ┌──────────────────────┐
          │ Task Control     │   │ build-dispatch       │  orchestrator/build-dispatch.ts
          │ Loop             │   │ (快通道)             │  绕过 decompose/plan/eval
          │ task-loop.ts     │   │ 直接跑 build agent   │  仍走 task 表 + trace
          └──────┬───────────┘   └──────────────────────┘
                 │
                 │ Decision Point (Orchestrator LLM)
                 │   触发: kind ∈ {created, batch_complete, retry}
                 │
                 ├──→ Requirements Agent   decompose/  (re-export: requirements/)
                 │      Zod tools → Goals[] + traceability
                 ├──→ Architect Agent      architect/
                 │      接口/目录/导出契约，写入 decision-log
                 ├──→ Design Analyst       design-analyst/
                 │      Figma/设计稿分析 (新增)
                 ├──→ Planner Agent        planner/per-goal.ts
                 │      per-goal 实现步骤
                 ├──→ Pipeline tools       pipeline/
                 │      runGoalPipeline → worktree + executor + delivery
                 ├──→ Evaluator            evaluator/  (确定性, no LLM)
                 ├──→ Delivery Agent       delivery/
                 │      diff 验收 + 回修
                 │
                 ▼
          ┌──────────────────┐
          │ GoalPool         │  orchestrator/goal-pool.ts
          │ drain → results  │  并行 dispatch, inactivity timeout
          └──────┬───────────┘
                 │
                 ▼
          ┌──────────────────┐
          │ Executor         │  executor/registry.ts
          │ claude-code /    │  claude-agent.ts / claude-cli.ts / claude-code.ts
          │ codex /          │  codex-cli.ts / codex-app-server.ts
          │ opencode         │  opencode.ts  (worktree/ 隔离)
          └──────────────────┘
```

**要点（SVG 里没有或过时的）：**
- **Gateway Agent** 是对话层唯一入口，替代了原 "用户直连 Orchestrator" 的假设。
  channel_key = `platform:channel:user` 或 `local:userID`，DB 有 partial unique
  index `session_gateway_singleton_idx` 保证单例。
- **build-dispatch** 是 `kind:"build"` 的快通道（`orchestrator/build-dispatch.ts`）。
  仍在 engine_task 表里，统一 cancel/list/audit，但跳过 decompose→plan→eval。
  Gateway 在创建 task 时决定 kind（workflow vs build）。
- **Design Analyst** 是新 sub-agent（Figma 分析），SVG Section A 未列。
- **requirements/** 只是 `decompose/` 的对外命名 re-export，图里可只保留 "Requirements"。
- Task Control Loop 的三种触发：`created` / `batch_complete` / `retry`——
  SVG Section C 的 "Orchestrator 动作" 需对齐这三个入口。

---

## 图 2 — 数据面全景（表 · 横切）

### orchestrator 域（18 张表，orchestrator.sql.ts）

| 表 | 作用 |
|---|---|
| `engine_task` | 顶层 task (queued/active/completed/failed/cancelled) |
| `engine_spec_snapshot` | 规格快照 |
| `engine_spec_item` | 规格明细项 |
| `engine_plan_version` | 计划版本（active/superseded） |
| `engine_milestone` | 里程碑 |
| `engine_goal` | Goal 节点 (pending/running/passed/failed) |
| `engine_requirement` | 需求追溯 |
| `engine_goal_snapshot` | Goal 快照 |
| `engine_plan_node` | 计划内步骤 |
| `engine_run` | Run 执行实例 (queued→running→completed/failed/aborted) |
| `engine_goal_run` | Goal × Run 关联 |
| `engine_interaction_request` | 权限/问询交互 |
| `engine_delivery` | 交付记录 |
| `engine_artifact` | 产物 |
| `engine_evaluation` | 评估结果 |
| `orchestrator_progress_snapshot` | 进度快照 |
| `engine_executor_session` | 执行器会话绑定 |
| `engine_channel_binding` | channel ↔ task 绑定（ChannelIngress 使用） |

### session 域（5 表）
`session` (含 `kind` + `channel_key`) · `message` · `part` · `todo` · `permission`

### 控制 / 工作区域
- `workspace` (workspace/workspace.sql.ts) — 多工作区代理
- `control_account` · `control_message` (control/control.sql.ts) — 外部控制账号
- `project` (project/project.sql.ts) — 项目

### 辅助 / 可观测
- `decision_log` — 全局共享 append-only 上下文（SVG 已有，表名未列）
- `workbench_task_note` · `workbench_brief_snapshot` — 面板数据
- `scratchpad` · `memory_file` · `memory_chunk` · `memory_embedding` · `task_plan` — memory
- `quick_note` — quicknote 存储
- `session_share` — 分享
- `protocol_event` · `protocol_inbox` · `protocol_stream_chunk` — executor 协议
- `task_queue` · `cron_job` · `event_job` — scheduler

### 横切（非表）
- **Trace** (`trace/index.ts`) — JSONL (`<instance>/.opencorvus/trace/<taskID>.jsonl`) + Bus 双写
  - 替代旧 AgentTrace (per-agent markdown) 和 env-gated LLMTrace
  - session/llm.ts hooks 自动记录每次 LLM 调用，agent 代码无需手工埋点
- **Bus** (`bus/bus-event.ts`) — 全局事件发布订阅，SSE 消费者从这里拿事件

**SVG 里需要新增的：**
- Section C 的 DB 表清单要对齐上述 18 + N 张表（目前缺 workspace / control_* / quick_note / memory_* / protocol_* / scheduler_* / orchestrator_spec_* 等）
- 新增「Trace 子系统」图块（横切，不在任何现有 section 内）

---

## 图 3 — 控制面与扩展入口

### 控制面（由内到外）

```
 bus/                全局 Bus.publish — 所有横切事件
  └─ bus-event.ts    类型安全的 event 定义

 trace/              JSONL + Bus 双写，替代 AgentTrace/LLMTrace

 control/            外部控制账号 + control_message 协议
  ├─ control_account · control_message 表
  ├─ message-schema.ts (入站 schema)
  └─ timeline.ts

 workspace/      多工作区代理层（和 control/ 不同）
  ├─ workspace (DB 表) + workspace-server/
  ├─ adaptors/ (worktree 适配)
  └─ session-proxy-middleware.ts (SSE 转发)

 channel/            外部消息渠道入口
  ├─ ingress.ts      ChannelIngress.message() 入口路由
  ├─ catalog.ts      ChannelId 枚举
  ├─ registry.ts     channel 注册
  ├─ supervisor.ts   子进程 runtime 生命周期
  ├─ slack.ts        Slack 实现
  └─ attachment.ts   附件处理 (Section K)

 server/             HTTP 路由（含 task-event SSE）
```

### 扩展入口（四条，架构级）

| 入口 | 目的 | 代码位置 |
|---|---|---|
| **executor/** | 跑代码的外部执行器 | claude-code / codex / opencode（各 3 种形态：CLI / agent / app-server） |
| **plugin/** | 无 executor 语义的外部工具 | codex / copilot |
| **mcp/** | MCP 协议 server | mcp/ |
| **acp/** | Agent Client Protocol（Zed 等） | acp/ |

**SVG 需要：**
- Section L（OVERLAY MESSAGE ROUTING）扩展为 "Channel/Gateway 消息路由"，涵盖
  所有入站路径：overlay / Slack / HTTP / ACP，最终都汇入 `ChannelIngress.message()` 或 Gateway agent。
- Section G（Provider）不用动，但应补一段「与 executor / plugin / mcp / acp 的关系」说明，
  避免读者把它们混为一谈（Provider = LLM 端；其余四条 = 工具/执行端）。

---

## 已删除 / 已废弃（SVG 里要清理）

| 项 | 证据 |
|---|---|
| `src/config/migrate-tui-config.ts` | git status: deleted |
| `src/storage/json-migration.ts` | git status: deleted |
| `test/config/fixtures/frontmatter.md` | git status: deleted |
| `test/storage/json-migration.test.ts` | git status: deleted |
| `src/calculator/` | 零外部消费者，仅自身 README 互引 — **建议用户确认后删除** |

---

## 新增 / 改动（SVG 里要加）

| 项 | 代码位置 | 影响的 SVG Section |
|---|---|---|
| Gateway agent | `gateway/` | A + L |
| channel_key 单例 | `session/channel-key.ts` + session_gateway_singleton_idx | A + L + C |
| build-dispatch 快通道 | `orchestrator/build-dispatch.ts` | A |
| Design Analyst agent | `design-analyst/` | A |
| Trace 统一埋点 | `trace/` | **新 Section** |
| 内置 PRD skill | `skill/builtin/prd-spec.md` | I (MiniWorkflow) |
| workspace 多工作区 | `workspace/workspace*` | 新节 or Section C |
| quick_note / memory_* 等辅助表 | 对应模块 `*.sql.ts` | Section C DB 清单 |

---

## 阶段 2 决策点（待用户决定）

**选项 A — 继续单 SVG**：新增 2 个 section（Trace / Gateway-Channel 路由），
Section A/C/L 大改，预计 SVG 膨胀到 1600+ 行。

**选项 B — 拆分 Markdown**：新建 `specs/new-arch/` 目录
- `README.md` 索引
- `01-agents.md` · `02-data.md` · `03-control.md` · `04-extensions.md`
- `new-arch.svg` 瘦身为三张总览框图（即本文档的图 1/2/3）

推荐 **B**。

---

## 阶段 3 任务清单（阶段 2 决策后才执行）

若选 A（单 SVG）：
1. [ ] 删 SVG 里 `migrate-tui-config` / `json-migration` 引用
2. [ ] Section A 加 Gateway + build-dispatch + Design Analyst 三个节点
3. [ ] Section C DB 清单对齐 `orchestrator.sql.ts` 18 表 + 其他域
4. [ ] 新增 Section M — Trace 子系统
5. [ ] Section L 重命名为 "Channel / Gateway 路由"，合并 ChannelIngress
6. [ ] Section G 补一段 executor/plugin/mcp/acp 分工说明
7. [ ] 与用户确认 calculator/ 删除

若选 B（拆分）：
1. [ ] 建目录 + 索引
2. [ ] 按四桶导出现有 SVG 文字内容
3. [ ] Gateway / Trace / build-dispatch 直接写新 MD
4. [ ] SVG 瘦身成三张总览图
5. [ ] 与用户确认 calculator/ 删除
