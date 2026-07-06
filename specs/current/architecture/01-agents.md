# 01 — Agent 家族

> 对应代码：`src/orchestrator/` · `src/engine/` · `src/agent/` · `src/requirements/` ·
> `src/architect/` · `src/build/` · `src/frontend-design/` · `src/intent-analysis/` ·
> `src/integrity/` · `src/acceptance/` · `src/acceptance/checks/` ·
> `src/executor/` · `src/task-api/` · `src/control/` ·
> `src/channel/` · `src/decision-log/`
>
> 注：旧 `src/pipeline/` 仅保留 `goal-contract.schema.ts` + `types.ts`
> 两个 schema 文件，运行时代码全部迁走；旧 goal-pool 模块与旧 pipeline executor 模块
> 已删除；the removed planning package 整目录删除（不再有 per-goal planning tool role，session 级的
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

**没有独立的 `build-dispatch.ts` 文件**：`engine_task.kind="build"` 的快通道路由由 scheduler 通过 `WorkflowRegistry.defaultIDForTaskKind("build")` 选择 task-kind 默认 workflow，并经由 `orchestrator/tools.ts` 的 `build` tool、`build/agent.ts` 的 `BuildAgent.run` 和 `engine/workflow.ts` 的 workflow registry 执行；`build.worktreeUsage` schema 允许 Orchestrator 模型在 `managed_worktree` 与 `current_project` 间选择，省略时 goal-scoped build 默认 managed worktree、task-level implementation build 默认当前项目 caller-owned `workDir`；current-project goal build 只把目录作为 session/report fact，不写入 goal managed workspace 指针；`goal/runner.ts` 只导出 `cleanupGoalWorkspace`，负责目标 worktree 生命周期末端清理，不承担 dispatch、worktree 创建或 executor 调用。

## MiniWorkflow — 两个声明式模板

`engine/workflow.ts` 定义两种 Orchestrator 可跟随的工作流（声明式 hint，不是硬状态机）：

| ID         | 适合                                                | 步骤                                                                                                                                                                                                        |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `direct`   | 显式 `kind=build` 的单文件 / bugfix / 配置 / 短调试 | `analyze_intent?` → `build`                                                                                                                                                                                 |
| `pipeline` | 多文件功能 / UI 复刻 / 跨模块重构                   | `frontend_design?` + `frontend_research?`（按任务作用域一次性产出证据 / handoff，不作为重复修复工具） → `requirements` → `architect` → `workload_analysis?` → per-goal `build` → `visual_qa?` / `integrity?` → Orchestrator lifecycle decision |

用户可在 `opencorvus.jsonc` 自定义，通过 `WorkflowRegistry.resolve(id)` 解析。Orchestrator 基于推理仍可偏离推荐步骤。

## Task Control Loop（kind=workflow）

```
orchestrator/loop.ts — runTaskLoop()
┌─────────────────────────────────────────────┐
│  Decision Point (Orchestrator LLM)          │
│    输入：自由形式 task event                │
│    不依赖 trigger.kind enum                 │
│    读 engine_* 全量 + decision-log          │
│    推理：调 sub-agent? 重试? 加 goal?       │
│           交付? 终止?                       │
└─────────────────┬───────────────────────────┘
                  │ 通过 tools (orchestrator/tools.ts)
                  ▼
        ┌─────────────────────────┐
        │  build tool             │  orchestrator/tools.ts (build:)
        │  goal 创建/复用 worktree  │  direct 使用当前 workDir
        │  (旧 goal pool / pipeline executor
        │   已删除，执行职责在 build tool + BuildAgent)
        └─────────────────┬───────┘
                          │
                          ▼
        ┌─────────────────────────┐
        │  build/agent.ts         │
        │  Worktree.create        │
        │  ExecutorRegistry       │
        │  opencorvus/codex/      │
        │  claude-code            │
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

**Loop 触发**：早期版本使用 `trigger.kind ∈ {created, batch_complete, acceptance_rejected, retry}` 枚举，当前已移除。当前 `runTaskLoop` 接受任意自由形式事件，由 LLM 读 `engine_*` + decision-log 事实后自行判断（无状态机拆除约束已并入 [16-unified-teardown.md](16-unified-teardown.md)）。

**Loop 消灭的旧机制**（不要再引入）：

- `recoverOrphanedTasks`（loop 本身就是生命周期；孤儿 task 由 `EngineService.init` 里的 serial-queue recovery 统一重启）
- `notifyGoalResult` fire-and-forget
- `agentNotifiedRuns` dedup
- host-side dispatch branch
- 无限 wake-up 循环

## Sub-agents

| Agent                 | 代码                                                                                                                                                                                 | 职责                                                                                                                                                                                                         | 何时被调用                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Intent Analysis       | `intent-analysis/agent.ts`                                                                                                                                                           | 解读用户的简短/模糊请求，输出 `IntentAnalysisResult`（intent class / complexity band / missing-info / clarifications）                                                                                       | 由 `analyze_intent` orchestrator tool 调起；可选 stage（已接线，旧 13 号文档"not wired yet"已过期） |
| Requirements          | `requirements/agent.ts`                                                                                                                                                              | Zod tool 输出 REQ-N + foundational decisions；不产出 goals                                                                                                                                                   | 当前 scheduler workflow 投影出 `requirements` 工具，或 Orchestrator 判断需要 requirements evidence    |
| Architect             | `architect/agent.ts`                                                                                                                                                                 | 权威 goal 分解者：必须先分析边界，再产出至少 2 个小型、可独立执行/验收的 goals；禁止单个大型 all-in-one goal；同时负责接口契约、追溯、fidelity / contract IR / linker                                        | 跨目标协调需要时                                                                                    |
| Frontend Design       | `frontend-design/agent.ts`                                                                                                                                                           | 视觉参考（Figma / 图片 / URL）→ 前端模板 / 待填充模块 / 视觉一致性契约；按任务视觉作用域一次性产出 handoff，后续修复消费该 handoff，不重复执行 frontend-design                                               | 有视觉参考的前端任务                                                                                |
| Frontend Research     | `frontend-research/agent.ts`                                                                                                                                                         | 网页 URL → 直接调查 prepared evidence 与源页面、汇总功能/视觉/layout/style/interaction/content/fidelity evidence brief；按网页调查作用域一次性产出 brief，后续修复消费该 brief，不重复执行 frontend-research | 有网页功能/视觉研究需求的前端或 PRD/SPEC/report 任务                                                |
| Goal Workload Analyst | `goal-workload-analyst/agent.ts`                                                                                                                                                     | 只读 goal 定型复核：深读 frontend template / contract graph / reference coverage，逐 goal 产反低估清单、验证清单与 `decomposition_concern`；不创建/修改 goal、不写代码、不作为 gate                          | Architect 产出 goal graph 后，特别是网页复刻、复杂 UI 或大型重构任务                                |
| Integrity Reviewer    | `integrity/team-agent.ts`                                                                                                                                                            | 对抗性 integrity review team：根据真实任务面动态选择 reviewer，复核 requirement scope、runtime evidence、实现质量与验收风险，输出 pass / non-pass 报告；旧固定维度 review 与 prosecutor 职责已并入此 team                               | 由 `integrity` orchestrator tool 调起（旧 `fidelity` kind 已并入此 agent）                          |
| Build                 | `build/agent.ts`（`BuildAgent.run`；同包 `index.ts` / `report.ts` / `types.ts`） + `goal/runner.ts`（`cleanupGoalWorkspace` 清理）+ `agent/sub-agent-protocol.ts`（共享 subagent 协议） | Orchestrator 通过 `build.worktreeUsage` 选择 managed worktree 或当前项目 caller-owned `workDir`；默认 goal-scoped 为 managed worktree、task-level implementation 为 current project；调用 `ExecutorRegistry.requireCoding` 并实际写代码；通过 task-scoped backend browser evidence 或 Browser MCP screenshot/observe 获取运行时截图证据；`goal/runner.ts` 不创建 worktree、不调用 executor | Orchestrator 通过 scheduler-projected `build` tool 调起                                             |

> Planner-as-agent 已删除。session 级的 `src/tool/planner.ts` 是一个 working-memory
> 工具（add*task / update_task / scratchpad*\*），任何 agent 都可以挂载它来管理自己的子
> 任务树，**不是** 旧 per-goal planner 的替代。goal-scoped implementation lane 里 "per-goal 实现步骤" 的职责
> 已归并到 build agent 自身（结合 architect 写的 contract）。

**Acceptance review 已删除**：任务完成 / 失败归属 Orchestrator 的 `complete_task` / `fail_task` lifecycle decision；`integrity` 只输出 review report，运行时截图证据归属 Build；旧 acceptance tool/service surface 不再存在。

**Orchestrator 当前显式 tool surface**（2026-06-27，真源是 `src/agent/tool-pool-contract.ts` 的 orchestrator private/global 列表和 `src/orchestrator/tools.ts` 实现；`deliver` / `publish_acceptance` / `steer_subagent` 已删除）：

1. **Stage / evidence 调用**：`requirements`、`frontend_design`、`frontend_research`、`deep_research`、`architect`、`workload_analysis`、`build`
2. **审查 / 复核**：`visual_qa`、`integrity`、`fact_check`、`analyze_intent`、`explore`
3. **Goal 维护**：`add_goal`、`modify_goal`、`query_failed_goals`、`goal_report`
4. **状态 / 上下文 / 预览**：`read_context`、`analytics`、`browser_preview`
5. **任务级控制**：`complete_task`、`fail_task`、`cancel_task`、`retry_task`、`inject_operator_message`、
   `cancel_subagent`（中止指定子 agent session；session 级恢复手段，取消后须显式重新
   dispatch 同一 goal/stage；如果来源是 pending `agent_coordination_request`，取消只能走
   `respond_agent_coordination(decision="cancel_worker")`）、`refine`
6. **用户交互 / 等待 / merge 修复**：`question`、`wait`、`bash`（仅项目根 git merge-state 修复）
7. **任务繁衍**：`propose_task`（按自动确认配置创建继承 follow-up task）
8. **A2A 协议响应**：`respond_agent_coordination` 是 orchestrator 回答 worker/operator-to-orchestrator coordination request 的唯一调度响应入口；它只能处理 durable `agent_coordination_request`，并写入 visible `agent_coordination_response` / `agent_coordination_action` 后执行 continue / cancel_worker / ask_user / fail_task / bound redispatch。

Worker 侧 A2A 请求入口是 `request_orchestrator_decision`，只暴露给 task worker / stage agent 工具池，不暴露给普通 coding 或 custom default。它创建 durable `agent_coordination_request` 并唤醒 task orchestrator；`requested_decision` 必须描述调度问题和证据，不得填 `redispatch` / `redispatch_worker` 这类 response action literal。worker 不应通过 task-root message、hidden note、direct reply 或新 subtask chat 请求调度决策。

Overlay targeted operator steer 的唯一入口是 `POST /task/:taskID/session/:sessionID/operator-steer` / `EngineService.operatorSteerAgentSession(...)`。它写入 `origin="operator_steer"` 的 durable `agent_coordination_request` 并唤醒 orchestrator，不写 task-root operator message，不写 child-session direct reply，也不伪造 `respond_agent_coordination` tool identity；后续动作仍由真实 orchestrator turn 通过 `respond_agent_coordination` 或其他 visible lifecycle action 决定。
`POST /task/:taskID/message` 只表示 task-root operator input；它不接受 `target` session/build 字段，不能作为 targeted sub-agent steer 的替代入口。

**Planning tool role 已删除**，因此 orchestrator 也没有 `planner` tool。goal-scoped build 路径里 "per-goal 实现步骤" 的旧 `planGoal()` 入口随同旧目标池模块一起删掉了；现在 build agent 直接读 architect contract + decision-log 自行推进。

`panel` control-plane tool **不**属于 orchestrator。Gateway 入口独占 panel capability action；orchestrator 只能通过自身的 workflow / task-control tools 推进任务。

orchestrator 通过 `propose_task` 提供"完善上一个 request 的新任务"候选；默认按 `experimental.auto_confirm_proposed_tasks=true` 直接调用 `EngineService.createTask`，只有该配置显式为 `false` 时才先等待用户确认。这不是恢复 `panel`，也不是恢复 generic `task` subagent 工具。

## Decision Log

- 全局共享 append-only 上下文（`src/decision-log/`）
- 所有 agent 可读写，通过 DI 注入
- Requirements 种子：runtime、stack
- Architect 写入：接口契约、目录蓝图、导出清单、命名规范
- 传递 **WHY** 不仅仅是 WHAT

## 外部执行器

Executor registry 同时包含内置 `opencorvus` executor 和外部 coding executor；它们都不属于 Agent Team：

- `executor/opencorvus.ts`
- `executor/codex.ts` · `codex-cli.ts` · `codex-app-server.ts` · `codex-app-server-client.ts`
- `executor/claude-code.ts` · `claude-agent.ts`
- 共享层：`bootstrap.ts` · `contract.ts` · `discovery.ts` · `external-process.ts` · `managed.ts` · `registry.ts` · `runtime-env.ts`

`executor/contract.ts` 的当前执行器名是 `opencorvus`、`codex`、`claude-code`。注册由 `executor/registry.ts` 管理；coding executor 的调用点是 `build/agent.ts` 的 `ExecutorRegistry.requireCoding` / `BuildAgent.run`；`goal/runner.ts` 只负责 `cleanupGoalWorkspace`。

## EngineService 入口一览

`src/task-api/index.ts` 是唯一的任务 API 入口（旧路径 `orchestrator/service.ts` 已迁移）。主要 export：

- `EngineService.init()` — 注册 scheduler poll、订阅 auto-permission、串行队列 recovery
- `EngineService.createTask(input)` — 创建任务 + 启动 Loop
- `EngineService.handleTaskMessage / operatorSteerAgentSession / injectMessage / replyInteraction / rejectInteraction / cancelTask / retryTask / updateGoal / deleteGoal / updateTaskChecks` — task mutation
- `EngineService.getBoard / getBrief / getProjectBoard / getGlobalTaskBoard` — workbench 视图（内部委托 `@/workbench/board` 与 `@/workbench/brief`）

## 相关文档

- [02-data.md](02-data.md) — `engine_*` 13 张表的行为
- [03-control.md](03-control.md) — ChannelIngress / ControlMessage / Panel Capability 路由
- [04-extensions.md](04-extensions.md) — Executor 与 plugin/mcp/acp 的边界
- [2026-06-27-add-opencorvus-agent-playbook.md](../../records/2026-06/2026-06-27-add-opencorvus-agent-playbook.md) — 新增 native agent 的单源接线、A2A、runtime、handoff、测试清单
- [13-agent-communication-matrix.md](13-agent-communication-matrix.md) — 预期 whitelist 与当前 direct/indirect 通信真相对照
