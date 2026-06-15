# 01 — Agent 家族

> 对应代码：`src/orchestrator/` · `src/engine/` · `src/agent/` · `src/requirements/` ·
> `src/architect/` · `src/build/` · `src/frontend-design/` · `src/intent-analysis/` ·
> `src/integrity/` · `src/prosecutor/` · `src/acceptance/` · `src/acceptance/checks/` ·
> `src/executor/` · `src/goal/runner.ts` · `src/task-api/` · `src/control/` ·
> `src/channel/` · `src/decision-log/`
>
> 注（2026-05-11 状态）：旧 `src/pipeline/` 仅保留 `goal-contract.schema.ts` + `types.ts`
> 两个 schema 文件，运行时代码全部迁走；`src/engine/goal-pool.ts` / `src/pipeline/executor.ts`
> 已在 Phase 5 删除；the removed planning package 整目录删除（不再有 per-goal planning tool role，session 级的
> `src/tool/planner.ts` 是 working-memory + scratchpad 工具，与旧 planning tool role 完全不同）；
> `src/decompose/` 已删除，需求分解逻辑统一落在 `src/requirements/`。

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

| 入口                       | 场景                                                         | 是否过 LLM                                                               |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **ChannelIngress.message** | 外部 bot / HTTP webhook；消息已有明确语义（reply / 新 task） | 否（确定性路由；命中 binding 且 task 有 pending interaction 则直接回填） |
| **ControlMessage.handle**  | 用户自然语言对话；需要理解意图；panel / slack / local        | 是（一次 LLM 推理，产出一个或多个 capability action）                    |

两者最终都汇入 `EngineService.createTask` 或 `Session` / `Question` 等既有 API。`ChannelIngress.message` 在无命中时也会 `ControlMessage.handle`（`surface = <platform>`）来创建任务。

## Task kind

`engine_task.kind ∈ { "workflow", "build" }`：

- `kind="workflow"`：默认路径，走完整 Task Control Loop（Orchestrator 决策 → Workflow 模板）。
- `kind="build"`：跳过 Orchestrator 分解 / 计划 / 评估，直接运行 build agent。用于一次性编辑、Q&A、简单修复。仍占用 `engine_task` 行，享受统一的 cancel / list / audit。

**没有独立的 `build-dispatch.ts` 文件**：`engine_task.kind="build"` 的快通道路由分布在 `orchestrator/agent.ts`（`task.kind === "build" ? "direct" : 默认 workflow`，~line 161）+ `orchestrator/tools.ts`（build tool 实现，~line 5075）+ `build/agent.ts`（build LLM 入口）+ `engine/workflow.ts`（`direct` workflow 模板）；`goal/runner.ts` 已只保留 `cleanupGoalWorkspace`（121 行），不再承担 dispatch。

## MiniWorkflow — 两个声明式模板

`engine/workflow.ts` 定义两种 Orchestrator 可跟随的工作流（声明式 hint，不是硬状态机）：

| ID         | 适合                              | 步骤                                                                                                    |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `direct`   | 单文件 / bugfix / 配置 / 短调试   | `build` → `deliver`                                                                                     |
| `pipeline` | 多文件功能 / UI 复刻 / 跨模块重构 | `frontend_design?` + `frontend_research?`（按任务作用域一次性产出证据 / handoff，不作为重复修复工具） → `requirements` → `architect` → per-goal `build` → `deliver` |

用户可在 `opencorvus.jsonc` 自定义，通过 `WorkflowRegistry.resolve(id)` 解析。Orchestrator 基于推理仍可偏离推荐步骤。

## Task Control Loop（kind=workflow）

```
orchestrator/loop.ts — runTaskLoop()
┌─────────────────────────────────────────────┐
│  Decision Point (Orchestrator LLM)          │
│    触发 kind:                               │
│      created / batch_complete /             │
│      acceptance_rejected / retry              │
│    读 engine_* 全量 + decision-log          │
│    推理：调 sub-agent? 重试? 加 goal?       │
│           交付? 终止?                       │
└─────────────────┬───────────────────────────┘
                  │ 通过 tools (orchestrator/tools.ts)
                  ▼
        ┌─────────────────────────┐
        │  build tool             │  orchestrator/tools.ts (build:)
        │  同步执行单个 goal       │  执行体：goal/runner.ts
        │  (旧 GoalPool / pipeline/executor.ts
        │   已在 Phase 5 删除，   │
        │   职责吸收至 build tool) │
        └─────────────────┬───────┘
                          │
                          ▼
        ┌─────────────────────────┐
        │  goal/runner.ts         │
        │  Executor (worktree)    │
        │  claude-code/codex/     │
        │  opencode               │
        └─────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────┐
        │  Checks                 │  acceptance/checks/
        │  deterministic runner   │  discovery / visual /
        │  + LLM judge            │  content-fingerprint /
        │                         │  runtime-evidence / types
        └─────────────────┬───────┘
                          │
                          ▼
              回到 Decision Point
```

**Loop 触发**：早期版本使用 `trigger.kind ∈ {created, batch_complete, acceptance_rejected, retry}` 枚举，已在 Phase 2 移除。当前 `runTaskLoop` 接受任意自由形式事件，由 LLM 读 `engine_*` + decision-log 事实后自行判断（参见 [15-no-fsm.md](15-no-fsm.md)）。

**Loop 消灭的旧机制**（不要再引入）：

- `recoverOrphanedTasks`（loop 本身就是生命周期；孤儿 task 由 `EngineService.init` 里的 serial-queue recovery 统一重启）
- `notifyGoalResult` fire-and-forget
- `agentNotifiedRuns` dedup
- dispatch gate
- 无限 wake-up 循环

## Sub-agents

| Agent              | 代码                                                                                                                                                                                                        | 职责                                                                                                                                                                                                         | 何时被调用                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Intent Analysis    | `intent-analysis/agent.ts`                                                                                                                                                                                  | 解读用户的简短/模糊请求，输出 `IntentAnalysisResult`（intent class / complexity band / missing-info / clarifications）                                                                                       | 由 `analyze_intent` orchestrator tool 调起；可选 stage（已接线，旧 13 号文档"not wired yet"已过期） |
| Requirements       | `requirements/agent.ts`                                                                                                                                                                                     | Zod tool 输出 REQ-N + foundational decisions；不产出 goals                                                                                                                                                   | pipeline workflow 或 Orchestrator 判断需要                                                          |
| Architect          | `architect/agent.ts`                                                                                                                                                                                        | 权威 goal 分解者：必须先分析边界，再产出至少 2 个小型、可独立执行/验收的 goals；禁止单个大型 all-in-one goal；同时负责接口契约、追溯、fidelity / contract IR / linker                                        | 跨目标协调需要时                                                                                    |
| Frontend Design    | `frontend-design/agent.ts`                                                                                                                                                                                  | 视觉参考（Figma / 图片 / URL）→ 前端模板 / 待填充模块 / 视觉一致性契约；按任务视觉作用域一次性产出 handoff，后续修复消费该 handoff，不重复执行 frontend-design                                                | 有视觉参考的前端任务                                                                                |
| Frontend Research  | `frontend-research/agent.ts`                                                                                                                                                                                | 网页 URL → 直接调查 prepared evidence 与源页面、汇总功能/视觉/layout/style/interaction/content/fidelity evidence brief；按网页调查作用域一次性产出 brief，后续修复消费该 brief，不重复执行 frontend-research | 有网页功能/视觉研究需求的前端或 PRD/SPEC/report 任务                                                |
| Integrity Reviewer | `integrity/agent.ts`                                                                                                                                                                                        | 多维 integrity review：requirement_fidelity / technical_feasibility / hallucination / solution_quality；最终 workflow 验收 gate                                                                              | 由 `integrity` orchestrator tool 调起（旧 `fidelity` kind 已并入此 agent）                          |
| Prosecutor         | `prosecutor/agent.ts`                                                                                                                                                                                       | 对交付候选发起对抗性复核                                                                                                                                                                                     | 由 `prosecute` orchestrator tool 调起                                                               |
| Build              | `build/agent.ts`（独立包：`agent.ts` / `index.ts` / `report.ts` / `types.ts`） + `goal/runner.ts`（worktree + executor 执行体）+ `agent/sub-agent-protocol.ts`（共享 subagent 协议） | 在 worktree 中实际写代码；通过 task-scoped backend browser evidence 或 Browser MCP screenshot/observe 获取运行时截图证据；通过 `Agent.get("build")` 暴露给 orchestrator                                                                                                                  | Orchestrator 通过 `build` tool 调起                                                                 |

> Planner-as-agent 已删除。session 级的 `src/tool/planner.ts` 是一个 working-memory
> 工具（add*task / update_task / scratchpad*\*），任何 agent 都可以挂载它来管理自己的子
> 任务树，**不是** 旧 per-goal planner 的替代。pipeline 流程里 "per-goal 实现步骤" 的职责
> 已归并到 build agent 自身（结合 architect 写的 contract）。

**Acceptance review 已删除**：最终验收归属 `integrity`，运行时截图证据归属 Build；旧 acceptance tool/service surface 不再存在。

**`orchestrator/tools.ts` 导出 task-level orchestration tools**（职责分组如下；以源码为准，避免在文档中维护易过期的数量）：

1. **Stage 调用**：`requirements`、`frontend_design`、`frontend_research`、`architect`、`build`、`deliver`
2. **Post-acceptance artifact export**：`publish_acceptance`（不决定 task lifecycle；accepted `deliver` 已完成 task）
3. **审查 / 复核**：`integrity`（integrity reviewer）、`prosecute`（prosecutor）、`analyze_intent`
4. **Goal 维护**：`modify_goal`、`query_failed_goals`
5. **状态 / 上下文**：`read_context`
6. **任务级控制**：`fail_task`、`cancel_task`、`retry_task`、`inject_operator_message`、
   `steer_subagent`、`cancel_subagent`（中止指定子 agent session；session 级恢复手段，
   取消后须显式重新 dispatch 同一 goal/stage）、`restart_from_stage`、`refine`
7. **用户交互**：`question`
8. **用户授权命令证据**：`bash`（仅当当前用户 / operator 消息明确需要命令结果或直接回答该需求需要一个小命令结果；不是执行器、不是测试循环、不是 repo 调查入口）
9. **任务繁衍**：`propose_task`（拟新建关联任务，需用户确认后才落 `EngineService.createTask`）

**Planning tool role 已删除**，因此 orchestrator 也没有 `planner` tool。pipeline build 路径里 "per-goal 实现步骤" 的旧 `planGoal()` 入口随同 `engine/goal-pool.ts` 一起删掉了；现在 build agent 直接读 architect contract + decision-log 自行推进。

`panel` control-plane tool **不**属于 orchestrator。Gateway 入口独占 panel capability action；orchestrator 只能通过自身的 workflow / task-control tools 推进任务。

orchestrator 通过 `propose_task` 提供"完善上一个 request 的新任务"候选；该工具必须先等待用户确认，确认后才调用 `EngineService.createTask`。这不是恢复 `panel`，也不是恢复 generic `task` subagent 工具。

## Decision Log

- 全局共享 append-only 上下文（`src/decision-log/`）
- 所有 agent 可读写，通过 DI 注入
- Requirements 种子：runtime、stack
- Architect 写入：接口契约、目录蓝图、导出清单、命名规范
- 传递 **WHY** 不仅仅是 WHAT

## 外部执行器

Executor 是**外部**进程，不属于 Agent Team：

- `executor/claude-code.ts` · `claude-agent.ts` · `claude-cli.ts`
- `executor/codex.ts` · `codex-cli.ts` · `codex-app-server.ts` · `codex-app-server-client.ts`
- `executor/opencode.ts`
- 共享层：`bootstrap.ts` · `contract.ts` · `discovery.ts` · `external-process.ts` · `managed.ts` · `registry.ts` · `runtime-env.ts`

注册到 `executor/registry.ts`，由 `goal/runner.ts` 在 worktree 内隔离执行，产出 acceptance diff。
（旧 `pipeline/executor.ts` 已删除；编排层已并入 build tool + goal/runner.ts。）

## EngineService 入口一览

`src/task-api/index.ts` 是唯一的任务 API 入口（旧路径 `orchestrator/service.ts` 已迁移）。主要 export：

- `EngineService.init()` — 注册 scheduler poll、订阅 auto-permission、串行队列 recovery
- `EngineService.createTask(input)` — 创建任务 + 启动 Loop
- `EngineService.handleTaskMessage / injectMessage / replyInteraction / rejectInteraction / cancelTask / retryTask / updateGoal / deleteGoal / updateTaskChecks` — task mutation
- `EngineService.getBoard / getBrief / getProjectBoard / getGlobalTaskBoard` — workbench 视图（内部委托 `@/workbench/board` 与 `@/workbench/brief`）

## 相关文档

- [02-data.md](02-data.md) — `engine_*` 13 张表的行为
- [03-control.md](03-control.md) — ChannelIngress / ControlMessage / Panel Capability 路由
- [04-extensions.md](04-extensions.md) — Executor 与 plugin/mcp/acp 的边界
- [13-agent-communication-matrix.md](13-agent-communication-matrix.md) — 预期 whitelist 与当前 direct/indirect 通信真相对照
