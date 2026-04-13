# 01 — Agent 家族

> 对应代码：`src/gateway/` · `src/task-agent/` · `src/agent/` · `src/decompose/` · `src/requirements/` ·
> `src/architect/` · `src/planner/` · `src/evaluator/` · `src/delivery/` · `src/design-analyst/` ·
> `src/executor/` · `src/pipeline/` · `src/orchestrator/`

## 核心原则

- **Agent 是 agent, Infrastructure 是 infrastructure**。LLM 推理和机械调度必须分层。
- Task Agent 是**唯一决策者**，看完整上下文，推理下一步动作。
- 没有固定 pipeline、没有机械 retry、没有自动 dispatch、没有 fallback。
- 每个 sub-agent 自带 LLM + tools，独立推理，被 Task Agent 调用。

## 入站与任务创建

```
外部渠道 → ChannelIngress.message()          channel/ingress.ts
(Slack/    入站路由 · 绑定 task_id
 HTTP)     → OrchestratorService / ControlMessage

本地用户 → Gateway Agent (LLM)               gateway/agent.ts
          per-channel 单例 session          session.channel_key 唯一索引
          工具集(gateway/tools.ts):
           - list_tasks / get_task / cancel_task
           - enqueue_task / dispatch_task
           - forward_clarification
           - switch_cwd
```

**Gateway Agent**：对话层唯一入口。
- 每个 channel 一个单例 session（`channel_key = platform:channel:user` 或 `local:userID`）。
- DB partial unique index `session_gateway_singleton_idx` 强制单例，race-safe。
- Gateway 决定 task 的 `kind`（workflow vs build），见下文。

## 两种 task kind

```
OrchestratorService.createTask({ kind })   orchestrator/service.ts

   kind="workflow" ──→ Task Control Loop      orchestrator/task-loop.ts
                       (Decision → Pool → repeat)

   kind="build"    ──→ build-dispatch         task-agent/build-dispatch.ts
                       绕过 decompose/plan/eval
                       直接跑 build agent on task.request
                       仍用 orchestrator_task 行 + trace
```

**为什么分叉**：
- `kind:"build"` 是已知结构的执行任务（例如 "build the package"），
  不需要 requirements 分解、不需要 architect 协调、不需要 evaluator 网关。
- Gateway 在创建时决定；运行时不会回退切换（禁止 fallback）。

## Task Control Loop（kind=workflow）

```
task-loop.ts
┌─────────────────────────────────────────────┐
│  Decision Point (Task Agent LLM)           │
│    触发 kind: created / batch_complete /    │
│              retry                          │
│    读 orchestrator_* 全量 + decision-log    │
│    推理: 调 sub-agent? 重试? 加 goal? 交付? │
└─────────────────┬───────────────────────────┘
                  │ 通过 tools (task-agent/tools.ts)
                  ▼
        ┌─────────────────────────┐
        │  GoalPool (goal-pool.ts)│
        │  submit → drain         │
        │  inactivity timeout     │
        │  (非硬超时)             │
        └─────────────────┬───────┘
                          │
                          ▼
        ┌─────────────────────────┐
        │  Executor (worktree)    │
        │  claude-code/codex/     │
        │  opencode               │
        └─────────────────────────┘
                          │
                          ▼
        ┌─────────────────────────┐
        │  Eval (deterministic)   │
        │  exit code → pass/fail  │
        └─────────────────┬───────┘
                          │
                          ▼
              回到 Decision Point
```

**Loop 的三种触发（kind）**：
1. `created` — 新任务，首次规划
2. `batch_complete` — 一批 goal 跑完（任意 pass/fail 组合），读新鲜上下文决定下一步
3. `retry` — 用户显式重试

**Loop 消灭的旧机制**（不要再引入）：
- `recoverOrphanedTasks`（loop 本身就是生命周期）
- `notifyGoalResult` fire-and-forget
- `agentNotifiedRuns` dedup
- dispatch gate
- 无限 wake-up 循环

## Sub-agents

| Agent | 代码 | 职责 | 何时被调用 |
|---|---|---|---|
| Requirements | `decompose/` + `requirements/` re-export | Zod tool 输出 Goals[] + 追溯矩阵 | 新任务开头（简单任务可跳过） |
| Architect | `architect/` | 接口契约、目录蓝图、导出清单；写 decision-log | 跨目标协调需要时 |
| Design Analyst | `design-analyst/` | Figma/设计稿分析 → 设计意图 | 有设计稿输入时 |
| Planner | `planner/per-goal.ts` | per-goal 实现步骤 | 执行前 |
| Evaluator | `evaluator/` | 确定性命令 runner（无 LLM） | delivery agent 调用 |
| Delivery | `delivery/` | diff 验收 + 回修 bug | 执行后 |

**所有 sub-agent 都通过 Task Agent 的 tools 调用**（`task-agent/tools.ts`），
不是固定顺序的 pipeline。

## Decision Log

- 全局共享 append-only 上下文（`src/decision-log/`）
- 所有 agent 可读写，通过 DI 注入
- Requirements 种子：runtime、stack
- Architect 写入：接口契约、目录蓝图、导出清单、命名规范
- 传递 **WHY** 不仅仅是 WHAT

## 外部执行器

Executor 是**外部**进程，不属于 Agent Team：

- `executor/claude-code.ts` · `claude-agent.ts` · `claude-cli.ts`
- `executor/codex.ts` · `codex-cli.ts` · `codex-app-server.ts`
- `executor/opencode.ts`

注册到 `executor/registry.ts`，通过 `pipeline/executor.ts` 在 worktree 里隔离执行，
产出 delivery diff。

## 相关文档

- [02-data.md](02-data.md) — orchestrator_task / goal / run 等 18 张表的行为
- [03-control.md](03-control.md) — Gateway 前面的 channel / bus / trace
- [04-extensions.md](04-extensions.md) — Executor 与 plugin/mcp/acp 的边界
