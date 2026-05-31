# 架构总览

OpenCorvus 的职责是：**把一条自然语言需求，稳定地变成已验证的代码变更**。这件事单个 LLM 做不到稳定，所以系统由一个**唯一决策者**（Orchestrator）和一组**专职 sub-agent** 组成；每个 agent 自带 LLM + tools，独立推理，由 Orchestrator 视情况调用。

> 重要变化（2026-05）：旧 `Task Agent / Planner / GoalPool / Evaluator agent` 已整体下线，pipeline 不再是硬编码的六层流水线；执行过程数据合并到 `engine_artifact` 单表（按 `kind` 区分）。详见 [Goal / Run / Task](./goal-run-task.md)。

## HTTP API 运行时分层

HTTP 服务器（`packages/opencorvus/src/server/server.ts`）把路由切成两个真实层：

- **Control plane（控制面）**——`/global/*`、`/auth/*`、`/ui/*`，以及 `/log`、`/shutdown`、`/restart`，挂载在 `Instance.provide` 中间件之前。即便没有打开任何项目目录也能工作。健康检查、服务生命周期、鉴权走这层。
- **Instance-scoped（实例域）**——其余全部路由（`/session`、`/task`、`/run`、`/mcp`、`/tui`、`/experimental`、`/panel` 等）跑在 `Instance.provide({ directory, init: InstanceBootstrap })` 内部。必须有项目目录（来自 `?directory=` query 或 `x-opencorvus-directory` header）。

路由 handler 本身不读 `process.env`、不调 `Database.use(...)`、不直连 SQL 表、不使用 `z.any()`。边界由 `bun run api:routes-check` 守护；双语 API 参考由 OpenAPI 通过 `bun run docs:api` / `docs:check` 自动生成。

## 入站：两个入口

```
外部渠道 → ChannelIngress.message       channel/ingress.ts
(Slack /  入站路由 · 绑定 task_id；命中 binding 且 task 有 pending interaction
 HTTP)    时确定性回填，否则进 ControlMessage

本地用户 → ControlMessage.handle        control/message.ts
 (overlay 短暂 "control" session（非 engine_task），以 PanelCapabilityRegistry
  / TUI)  为白名单输出 JSON action（create_task / send_task_message /
          reply_interaction / cancel_task / retry_task / …）
```

两个入口最终都汇入 `EngineService.createTask`（`task-api/index.ts`）或既有的 `Session` / `Question` API。

## Task 控制循环（kind = `workflow`）

```
orchestrator/loop.ts — runTaskLoop()  (line 117)
┌──────────────────────────────────────────────┐
│  Decision Point (Orchestrator LLM)            │
│    读 engine_* 全量 + decision-log            │
│    推理：调哪个 sub-agent？重试？加 goal？     │
│           交付？终止？                         │
└────────────┬─────────────────────────────────┘
             │ 通过 orchestrator/tools.ts 21 个 tool
             ▼
    ┌─────────────────────────────────────┐
    │ sub-agent（按需调用）                │
    │  requirements / architect /         │
    │  frontend_design / build /          │
    │  integrity / prosecute /            │
    │  analyze_intent / deliver / …       │
    └────────────┬────────────────────────┘
                 │ build tool → goal/runner.ts
                 ▼
    ┌─────────────────────────────────────┐
    │ Executor（外部进程，worktree 隔离）  │
    │  claude-code / codex / opencode     │
    └────────────┬────────────────────────┘
                 │ delivery diff
                 ▼
    ┌─────────────────────────────────────┐
    │ delivery/checks/  确定性 + LLM judge │
    └────────────┬────────────────────────┘
                 ▼
          回到 Decision Point
```

`kind = "build"` 任务跳过分解 / 计划 / 评估，直接走 build tool（`engine_task` 行仍保留，享受统一的 cancel / list / audit）。

### 不再有

- ~~`Task Agent` / `Planner` agent / `GoalPool` / `evaluator` agent~~（Phase 5–6 删除）
- ~~`recoverOrphanedTasks` fire-and-forget~~（loop 本身就是生命周期；孤儿 task 由 `EngineService.init` 串行队列统一重启）
- ~~dispatch gate / 无限 wake-up~~
- ~~硬编码 6 层流水线~~——替换为 `engine/workflow.ts` 的两个声明式 MiniWorkflow（见下），Orchestrator 视情况偏离推荐路径

## MiniWorkflow — 两种声明式模板

| ID | 适合 | 推荐步骤 |
|---|---|---|
| `direct` | 单文件 / bugfix / 配置 / 短调试 | `build` → `deliver` |
| `pipeline` | 多文件功能 / UI 复刻 / 跨模块重构 | `frontend_design?` → `requirements` → `architect` → per-goal `build` → `deliver` |

定义在 `engine/workflow.ts`，用户可在 `opencorvus.jsonc` 自定义；Orchestrator 通过 `WorkflowRegistry.resolve(id)` 取模板，仍可根据推理偏离。

## Sub-agent 一览

| Agent | 代码 | 职责 |
|---|---|---|
| **Orchestrator** | `orchestrator/agent.ts` + `orchestrator/loop.ts` | 唯一决策者；通过 21 个 tool 推进任务 |
| **Intent Analysis** | `intent-analysis/agent.ts` | 解读简短 / 模糊请求，输出 intent class / complexity / clarifications |
| **Requirements** | `requirements/agent.ts` | Zod tool 输出 REQ-N + foundational decisions；不产出 goals |
| **Architect** | `architect/agent.ts` | 先分析边界，再产出至少 2 个小型、可独立执行/验收的 goals；禁止单个大型 all-in-one goal；同时负责接口契约、追溯与 fidelity |
| **Frontend Design** | `frontend-design/agent.ts` | 视觉参考（Figma / 图片 / URL）→ 前端模板 / 待填充模块 / 视觉一致性契约 |
| **Build** | `build/agent.ts` + `build/index.ts` + `build/report.ts` + `build/types.ts` + `goal/runner.ts` + `agent/sub-agent-protocol.ts` | 在 worktree 中实际写代码；由 Orchestrator 通过 `build` tool 调起 |
| **Integrity Reviewer** | `integrity/agent.ts` | 多维 integrity review（requirement_fidelity / technical_feasibility / hallucination / solution_quality） |
| **Prosecutor** | `prosecutor/agent.ts` | 对交付候选发起对抗性复核 |
| **Delivery** | `delivery/agent.ts` + `delivery/checks/` + `delivery/specialists/` | diff 验收 + 触发回修 + 确定性 / LLM judge 检查；可按交付证据触发 `run_integrity_review` 语义完整性复核 |

Task 生命周期的 agent-side 权限只属于 **Orchestrator**：启动 / 停止 / retry / cancel / fail 当前 task，以及发布新的 follow-up task，都必须通过 Orchestrator 的显式 lifecycle tools（例如 `propose_task`）。Delivery 只能输出验收 verdict、证据和建议，不能直接创建、取消、重试或终止 engine task。

> **Planner agent 已删**。session 级的 `src/tool/planner.ts` 是 working-memory 工具（`add_task / update_task / scratchpad_*`），任何 agent 均可挂载来管自己的子任务树；它**不是**旧 per-goal planner 的替代。
>
> **Evaluator agent 已删**。验证职责并入 `delivery/checks/`（`discovery.ts` 解析 check family → `per-goal.ts` / `llm-judge-runner.ts` / `visual.ts`）。

## 两层循环

### 外层：Task 控制循环

`runTaskLoop`（`orchestrator/loop.ts:117`）：

```
while (!aborted) {
  Orchestrator.processTask()      ← LLM 决策：调哪个 sub-agent
  await sub-agent / build tool 完成
  回到决策点（不机械分阶段）
}
```

触发事件无白名单：早期 `trigger.kind ∈ {created, batch_complete, delivery_rejected, retry}` 已在 Phase 2 移除，由 LLM 自己看 `engine_*` + decision-log 判断。

### 内层：Session agentic loop

`SessionLoop`（`session/loop.ts:62`，namespace）：

```
while (session 活跃) {
  LLM 出 tool-call → 工具执行 → 结果回填 part → 下一轮
}
```

连接两层的是 build tool → `goal/runner.ts`：在 worktree 内启动 executor session（OpenCorvus / Codex / Claude Code），prompt 注入后驱动内层 SessionLoop。

详见 [Agentic Loop](./agent-loop.md)。

## 为什么不是单体 agent

1. **各阶段的输入/输出契约不同**：requirements 产 Goal + 追溯矩阵；architect 产契约 IR；delivery checks 产 verdict + 证据。混在一起会遗漏检查。
2. **失败要能精确归因**：requirements 错→重 requirements；architect 错→重 architect；build 错→retry build；delivery 错→回修。这种分级处理在"单体 agent"里做不到。
3. **可并行 / 可隔离**：每个 build 在独立 git worktree 跑（见 [Worktree 生命周期](../../../specs/new-arch/10-worktree-lifecycle.md)），互不污染；同任务多 goal 并行上限由 `assistant.max_executor_groups` 控制（默认 3）。
4. **人机协作粒度**：permission 审批、follow-up 消息、`question` tool 都发生在 Task 循环里，不会污染单次 LLM 上下文。

## Worktree 并行

每个 build attempt 独立 worktree（路径写入 `engine_artifact[kind="goal_run_attempt"].payload`，读取经 `engine/store.ts:findGoalLatestWorkspace`）。失败的 attempt 重试时不影响其他 goal；最终合并由 `delivery` agent 负责。

## 数据流与数据模型

执行过程合并到 `engine_artifact` 单表（13 张表中的一张），用 `kind` 区分语义：`run` · `goal_run_attempt` · `delivery` · `verification-evidence` · `evaluation` · `verdict` · `patch` · `changed_file` · `diff` · `log` · `report` · `image` · `link` · `git_ref` · `pr` · `integrity_attempt` · `prosecutor_attempt` · `delivery_evidence_manifest` · `delivery_surface_manifest` · `delivery_specialist_review` · `delivery_verification_threw` · `architect_contract_graph` · `orchestrator-stream-error`。

详见 [Goal / Run / Task](./goal-run-task.md)。

## 你接下来要看的

- [Goal / Run / Task 数据模型](./goal-run-task.md)
- [Agentic Loop 内循环](./agent-loop.md)
- [OpenCorvus 配置](../opencorvus/configuration.md)
- [Delivery 检查与判决](../opencorvus/evaluator.md)
