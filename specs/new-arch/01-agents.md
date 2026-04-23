# 01 — Agent 家族

> 对应代码：`src/orchestrator/` · `src/engine/` · `src/agent/` · `src/requirements/` ·
> `src/architect/` · `src/planner/` · `src/design-analyst/` · `src/delivery/` · `src/delivery/checks/` ·
> `src/executor/` · `src/pipeline/` · `src/goal/` · `src/task-api/` · `src/control/` · `src/channel/`

## 核心原则

- **Agent 是 agent, Infrastructure 是 infrastructure**。LLM 推理和机械调度必须分层。
- Orchestrator 是**唯一决策者**，看完整上下文，推理下一步动作。
- 没有固定 pipeline、没有机械 retry、没有自动 dispatch、没有 fallback。
- 每个 sub-agent 自带 LLM + tools，独立推理，被 Orchestrator 调用。

## 入站与任务创建

```
外部渠道 → ChannelIngress.message()           channel/ingress.ts
(Slack/    入站路由 · 绑定 task_id
 HTTP)     → ControlMessage.handle()          control/message.ts
           → EngineService.createTask()       task-api/index.ts

本地用户 → ControlMessage (LLM 面板会话)      control/message.ts
 (overlay  短暂 "control" session（非 engine_task），以
  TUI)     PanelCapabilityRegistry 为白名单输出 JSON
           action：create_task / send_task_message /
           reply_interaction / cancel_task / retry_task …
           → 逐项路由到 EngineService / Session 等 API
```

**旧的 Gateway Agent 已删除**：不再有 per-channel 单例 session、不再有 `session_gateway_singleton_idx`、不再有 `channel_key`。对话层的"理解用户意图"职责由 `ControlMessage` 承担，它使用通用 `Agent.defaultAgent()` + `PanelCapabilityRegistry`（见 `panel/capability.ts`），通过受限的 JSON action 集合与系统交互，而不是给 LLM 一个自由的 tool 集合。

### 两个入站入口的分工

| 入口 | 场景 | 是否过 LLM |
|---|---|---|
| **ChannelIngress.message** | 外部 bot / HTTP webhook；消息已有明确语义（reply / 新 task） | 否（确定性路由；命中 binding 且 task 有 pending interaction 则直接回填） |
| **ControlMessage.handle** | 用户自然语言对话；需要理解意图；panel / slack / local | 是（一次 LLM 推理，产出一个或多个 capability action） |

两者最终都汇入 `EngineService.createTask` 或 `Session` / `Question` 等既有 API。`ChannelIngress.message` 在无命中时也会 `ControlMessage.handle`（`surface = <platform>`）来创建任务。

## Task kind

`engine_task.kind ∈ { "workflow", "build" }`：

- `kind="workflow"`：默认路径，走完整 Task Control Loop（Orchestrator 决策 → Workflow 模板）。
- `kind="build"`：跳过 Orchestrator 分解 / 计划 / 评估，直接运行 build agent。用于一次性编辑、Q&A、简单修复。仍占用 `engine_task` 行，享受统一的 cancel / list / audit。

**没有独立的 `build-dispatch.ts` 文件**：build 快通道逻辑内嵌在 `goal/runner.ts`（session `kind="build"`，以 `build-dispatch` 作为 session 标签）。

## MiniWorkflow — 两个声明式模板

`engine/workflow.ts` 定义两种 Orchestrator 可跟随的工作流（声明式 hint，不是硬状态机）：

| ID | 适合 | 步骤 |
|---|---|---|
| `direct` | 单文件 / bugfix / 配置 / 短调试 | `build` → `deliver` |
| `pipeline` | 多文件功能 / UI 复刻 / 跨模块重构 | `design_analysis?` → `requirements` → `architect` → per-goal `build` → `deliver` |

用户可在 `opencorvus.jsonc` 自定义，通过 `WorkflowRegistry.resolve(id)` 解析。Orchestrator 基于推理仍可偏离推荐步骤。

## Task Control Loop（kind=workflow）

```
orchestrator/loop.ts — runTaskLoop()
┌─────────────────────────────────────────────┐
│  Decision Point (Orchestrator LLM)          │
│    触发 kind:                               │
│      created / batch_complete /             │
│      delivery_rejected / retry              │
│    读 engine_* 全量 + decision-log          │
│    推理：调 sub-agent? 重试? 加 goal?       │
│           交付? 终止?                       │
└─────────────────┬───────────────────────────┘
                  │ 通过 tools (orchestrator/tools.ts)
                  ▼
        ┌─────────────────────────┐
        │  GoalPool               │  engine/goal-pool.ts
        │  submit → drain         │
        │  inactivity timeout     │
        │  (非硬超时)             │
        └─────────────────┬───────┘
                          │
                          ▼
        ┌─────────────────────────┐
        │  goal/runner.ts         │
        │  pipeline/executor.ts   │
        │  Executor (worktree)    │
        │  claude-code/codex/     │
        │  opencode               │
        └─────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────┐
        │  Checks                 │  delivery/checks/
        │  deterministic runner   │  discovery / per-goal /
        │  + LLM judge            │  llm-judge-runner /
        │                         │  visual
        └─────────────────┬───────┘
                          │
                          ▼
              回到 Decision Point
```

**Loop 的四种触发（trigger.kind）**：
1. `created` — 新任务，首次规划
2. `batch_complete` — 一批 goal 跑完（任意 pass/fail 组合），读新鲜上下文决定下一步
3. `delivery_rejected` — delivery agent 打回（验收不通过），带 feedback
4. `retry` — 用户显式重试

**Loop 消灭的旧机制**（不要再引入）：
- `recoverOrphanedTasks`（loop 本身就是生命周期；孤儿 task 由 `EngineService.init` 里的 serial-queue recovery 统一重启）
- `notifyGoalResult` fire-and-forget
- `agentNotifiedRuns` dedup
- dispatch gate
- 无限 wake-up 循环

## Sub-agents

| Agent | 代码 | 职责 | 何时被调用 |
|---|---|---|---|
| Requirements | `requirements/agent.ts` | Zod tool 输出 Goals[] + 追溯矩阵 + fidelity | pipeline workflow 或 Orchestrator 判断需要 |
| Architect | `architect/agent.ts` | 接口契约、目录蓝图、导出清单；写 decision-log | 跨目标协调需要时 |
| Design Analyst | `design-analyst/agent.ts` | 视觉参考（Figma / 图片 / URL）→ 布局 / 样式 / 组件清单 | 有视觉参考的前端任务 |
| Planner | `planner/agent.ts` | per-goal 实现步骤 | 当前由 `engine/goal-pool.ts` 在 per-goal build 前调用；不是 Orchestrator 的显式 tool |
| Delivery | `delivery/agent.ts` | diff 验收 + 触发回修（通过 delivery_rejected 重新 call build） | 每个 workflow 末尾 |
| Build | 由 `Agent.get("build")` 解析为 executor session | 在 worktree 中实际写代码 | Orchestrator 通过 `build` tool 调起 |

**Checks（原 evaluator 模块）**：移到 `delivery/checks/`，不再是独立 sub-agent。delivery agent 通过 `discovery.ts` 解析 check family，调 `per-goal.ts` / `llm-judge-runner.ts` / `visual.ts` 执行确定性或 LLM judge 验证。旧 `src/evaluator/` 目录已删除。

**当前主要 stage-agent 调用点**：`orchestrator/tools.ts`（`requirements / design_analysis / architect / build / deliver`）。
**例外**：`planner/agent.ts` 当前由 `engine/goal-pool.ts` 在 per-goal build 前调用；见 [13-agent-communication-matrix.md](13-agent-communication-matrix.md)。

## Decision Log

- 全局共享 append-only 上下文（`src/decision-log/`）
- 所有 agent 可读写，通过 DI 注入
- Requirements 种子：runtime、stack
- Architect 写入：接口契约、目录蓝图、导出清单、命名规范
- 传递 **WHY** 不仅仅是 WHAT

## 外部执行器

Executor 是**外部**进程，不属于 Agent Team：

- `executor/claude-code.ts` · `claude-agent.ts` · `claude-cli.ts`
- `executor/codex-cli.ts` · `codex-app-server.ts` · `codex-app-server-client.ts`
- `executor/opencode.ts`

注册到 `executor/registry.ts`，通过 `pipeline/executor.ts` 在 worktree 里隔离执行，
产出 delivery diff。

## EngineService 入口一览

`src/task-api/index.ts` 是唯一的任务 API 入口（旧路径 `orchestrator/service.ts` 已迁移）。主要 export：

- `EngineService.init()` — 注册 scheduler poll、订阅 auto-permission、串行队列 recovery
- `EngineService.createTask(input)` — 创建任务 + 启动 Loop
- `EngineService.taskMessage / replyInteraction / rejectInteraction / cancelTask / retryTask / updateGoal / deleteGoal / updateTaskChecks` — task mutation
- `EngineService.compileBoard / compileBrief` — workbench 视图

## 相关文档

- [02-data.md](02-data.md) — `engine_*` 18 张表的行为
- [03-control.md](03-control.md) — ChannelIngress / ControlMessage / Panel Capability 路由
- [04-extensions.md](04-extensions.md) — Executor 与 plugin/mcp/acp 的边界
- [13-agent-communication-matrix.md](13-agent-communication-matrix.md) — 预期 whitelist 与当前 direct/indirect 通信真相对照
