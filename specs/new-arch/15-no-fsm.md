# 状态机全砍（facts-only + LLM 决策）重构计划

> **DEPRECATED — 2026-04-25**：本文档是 16-unified-teardown.md 的前身；阶段 7 完成后归档。请以 `specs/new-arch/16-unified-teardown.md` 为准，该文档在此规划基础上纳入了 GoalPool / AgentRuntime / 读模型切换 / schema 清零 / recovery.ts 删除的完整落地。
>
> **2026-04-27 状态核查**：5 张过程状态表已在 Phase 6 合并为 `engine_artifact`（见 [02-data.md](02-data.md)），
> 但代码侧仍存在以下 FSM-shaped 残留（需在新 ticket 单独清零）：
>
> - `engine/runtime.ts:123-132` 仍用 `run.status === "completed" / "failed" / "aborted"` 分支轮询，
>   未替换为 `time_completed != null` 派生
> - `engine/goal-status.ts:40-62` `mapRunStatus` 仍是 switch/case，与"事实派生"原则不一致

- 日期：2026-04-24
- 分支起点：`rc-2026-04-13 @ 1c07ee2d1`（wip: checkpoint before state-machine teardown）
- 触发事件：task `tsk_dbe77dfce001Lh8rA66fISdbGF` 卡死。引擎重启后 `recoverOrphanRuns` 把 run 标 `aborted`，但 task 仍 `active`，goal#4 永远不会被调度。
- 约束：CLAUDE.md 规则 23（禁止状态机）、规则 22（禁止双源）、规则 13（遇包袱直接 reset DB）

---

## 1. 问题本质

opencorvus 核心有 5 张"状态机表"互相信任但不对齐：

| 表                  | 状态字段                                         |
| ------------------- | ------------------------------------------------ |
| `engine_task`       | `status`, `blocking_reason`                      |
| `engine_run`        | `status`, `phase`, `blocking_reason`             |
| `engine_goal_run`   | `status`, `blocking_reason`, `superseded_reason` |
| `engine_acceptance` | `status`（candidate / accepted / rejected…）     |
| `engine_evaluation` | `status`, `verdict`                              |

代码里 ~30 个文件、~74 处 `if (x.status === "Y")` / switch 分支消费这些字段。以前几轮删掉的是*场景化*状态机（某个具体流程的 FSM），但这 5 张表本身是根 FSM，每删一处代码都会被 loop / workflow / recovery 的隐式协议拖回去。

**典型症状链**：

1. goal 1~3 acceptance=candidate（未 accept）；
2. task 级聚合评估 `acceptance_verdict=failed`；
3. 引擎重启；
4. `recovery.ts:132` 判 run 孤儿 → `abortRuns(..., "Process restart: run lost live executor state during recovery")`；
5. `engine_run.status=aborted`，`engine_task.status=active` —— 双状态机失去同步；
6. 没有组件有义务处理 "active task 指向 aborted run" 这个组合 → goal#4 永远 pending。

---

## 2. 目标状态

**事实 + 决策**：

- **事实列**：`time_created`、`time_started`、`time_completed`、`error`、`commit_ref`、`lease_until`、`last_progress_at`、进程心跳、executor session 活性、evaluation artifact payload。全部不可变或单调前进。
- **决策**：由 Orchestrator Agent 读 `describeTask()` 事实快照作出，不由 if/switch 分支推理。

衍生定义（由 describe 层统一 derive，不写回）：

```
goal_run_done(gr)       = gr.time_completed != null
goal_run_failed(gr)     = goal_run_done(gr) && gr.error != null
goal_run_passed(gr)     = goal_run_done(gr) && gr.error == null && gr.commit_ref != null
run_live(r)             = (exists live goal_run with coordinator_run_id=r.id)
                          || (exists live executor_session with run_id=r.id)
run_orphan(r)           = r.time_completed == null && !run_live(r)
task_done(t)            = t.time_completed != null
task_failed(t)          = task_done(t) && t.error != null
```

---

## 3. Schema 最终形态

| 表                  | 删除列                                           | 保留                                                                                                       |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `engine_task`       | `status`, `blocking_reason`                      | `time_completed`, `error`, `active_plan_version_id`, `active_run_id`                                       |
| `engine_run`        | `status`, `phase`, `blocking_reason`             | `time_started`, `time_completed`, `error`, `executor_ref`, `session_id`, `plan_version_id`                 |
| `engine_goal_run`   | `status`, `blocking_reason`, `superseded_reason` | `time_started`, `time_completed`, `error`, `supersede_of`, `lease_until`, `last_progress_at`, `commit_ref` |
| `engine_acceptance` | `status`                                         | `result`（JSON 含 verdict/summary/artifacts）, `run_id`, `goal_run_id`                                     |
| `engine_evaluation` | `status`, `verdict`                              | `summary`, `artifacts`                                                                                     |

> acceptance / evaluation 的 `verdict / status` 原本已经在 artifact payload 里，当前列是冗余，删之无痛。

---

## 4. 新决策点

`runTaskLoopInner` 收敛为：

```
loop:
  snapshot = describeTask(taskID)       # 事实包；含 run_orphan / executor_alive /
                                        #   pending_interactions / last_activity_ms 等
  if snapshot.task.time_completed != null: exit
  decision = await Orchestrator.decide(snapshot, trigger)
  trigger  = await executeDecision(decision)
```

Orchestrator 看 snapshot 自行选择工具：

- 起新 plan / architect
- `dispatch_goal` / `restart_from_stage`
- `wait_for_executor`（带 inactivity 阈值，由 LLM 给）
- `complete_task`（写 `time_completed`，无 error）
- `fail_task`（写 `time_completed` + error）

**彻底消失的代码模式**：

- `if (run.status === "blocked")` → pending interaction 是事实，LLM 自判。
- `if (queue.status === "running")` → executor 报文是事实，不写回 run.status。
- `recoverOrphanRuns(abortRuns)` → recovery 只做物理清理（杀死已 detach 的 executor_session），**不改 run**；LLM 下一次 decide 时从 `run_orphan=true` 自行判断。

---

## 5. 分 5 轮落地（每轮独立可回退；涉及 schema 的轮次直接 reset DB）

### 轮 1 —— 本次 (c)：断开 run ↔ task 双状态机致死路径

**不改 schema**，只拆掉引起本次卡死的那条写入路径。

改动：

1. `packages/opencorvus/src/engine/recovery.ts`
   - `recoverOrphanRuns` 改名 `observeOrphanRuns`：**不调用 `abortRuns`**，只返回 orphan run 列表 + 日志 + 事件（让 Orchestrator 下一次 decide 看到事实）。
   - `recoverProjectExecution` 调用点保留"返回 orphan 数量"的日志形态。
2. `packages/opencorvus/src/engine/describe.ts`
   - task snapshot 增字段 `run_orphan: boolean`，derive 规则同第 2 节；保留对现有消费者零破坏。
3. `packages/opencorvus/src/orchestrator/agent.ts`（prompt）
   - 新增一条指引："若 snapshot.run_orphan=true，不要复用此 run；应当调 restart_from_stage 或 dispatch_goal 起新 run。"
4. 补一条 regression 测试：模拟 process restart 后 orphan run 场景，断言 task 仍可推进到 goal#4，而不是冻结。

轮 1 完成标志：本条 task（或等价 fixture）重启后，goal#4 能被派起来；原 run `status` 列内容如何无所谓。

### 轮 2 —— describe 层扩成完整事实包 + 清 loop 状态分支

- describe 增：`executor_alive`, `pending_interactions`, `last_activity_ms`, `live_goal_run_ids`, `tip_is_orphan`。
- 删 `orchestrator/loop.ts` 中 `task.status === "completed"|"failed"|"cancelled"` 3 处分支，改为读 `task.time_completed != null`。
- 删 `engine/runtime.ts:syncRun` 中 `run.status === "completed"|"failed"|"aborted"` 的提前 return，改为读 `run.time_completed`。

### 轮 3 —— 删 acceptance / evaluation 的 status+verdict 冗余列

- verdict 已经在 `result.verdict / payload.verdict` artifact 里；删两张表的 `status` + `evaluation.verdict` 列。
- `acceptance/verdict.ts`、`acceptance/output-tools.ts` 改为纯 artifact 读写，无状态枚举分支。
- reset DB。

### 轮 4 —— 删 `engine_run.status / phase / blocking_reason`

- recovery 彻底退化为"关 session + emit 事件"。
- `engine_run` 的 "live / terminal" 概念统一由 `time_completed` + 关联事实 derive。
- `engine/queue.ts`、`engine/workflow.ts`、`scheduler/*`、`executor/managed.ts` 里所有 `run.status === "X"` 用法一次性迁移。
- reset DB。

### 轮 5 —— 删 `engine_task.status / blocking_reason`

- 队列服务 `scheduler/task-queue-service.ts` 按 `time_completed IS NULL` 重写 "active tasks" 查询。
- TUI / ACP / MCP 里显示 status 的地方，改成 derive 出的 `"running" | "done" | "failed"`（纯 UI 层，不回写）。
- reset DB。

---

## 6. 验收标准

- `rg "\.status\s*===\s*['\"]` 在 `packages/opencorvus/src/engine|orchestrator|acceptance|scheduler` 下命中 = 0。
- DB schema 里 `status` / `phase` / `verdict` / `blocking_reason` 列全部消失。
- 本次 tsk_dbe77dfce001Lh8rA66fISdbGF 同形状 fixture 在 process-restart + 前序 acceptance 未通过场景下，task loop 能持续推进而不依赖任何"状态转移"。
- `recoverProjectExecution` 单测：重启后 run 不被标任何"终态"，LLM 决策路径拿到 `run_orphan=true` 事实。

---

## 7. 本次 (c) 动手清单

- [ ] `engine/recovery.ts` → `observeOrphanRuns`（不 abort，仅观测）
- [ ] `engine/describe.ts` → task snapshot 增 `run_orphan`
- [ ] `orchestrator/agent.ts` → prompt 增 orphan 指引
- [ ] regression test
- [ ] commit message：`refactor(engine): stop aborting orphan runs in recovery — expose as fact to orchestrator (state-machine teardown round 1/5)`
