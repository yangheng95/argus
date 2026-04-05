# 并行 Goal 架构演进路线图 (P0 → P5)

**Base**: `candidate-clean` at `a87f298ca`
**Design source**: `specs/new-arch.svg`
**Scope**: 演进当前并行验收/重试架构，解决从 "10 goals 能跑" 到 "100+ goals 稳定" 的 structural gap。

## 当前架构的 5 个隐含假设（都会崩溃）

| # | 假设 | 崩溃点 |
|---|-----|--------|
| 1 | 任务规模有限（~10 goals） | 100+ goals → Task Agent attention 爆掉 |
| 2 | goal 边界清晰（owned_paths 互斥） | goals 共享 types/schema/utils → 互斥覆盖不到 |
| 3 | 架构静态可预测（architect 一次性冻结） | executor 发现契约错 → 无法协商 |
| 4 | 失败原因独立（per-goal eval 能定位） | 集成 bug（goal A+B 组合失败）看不到 |
| 5 | LLM 决策可靠（不会挑错 goalID） | LLM 错了就破坏已有状态（3/7→2/7 已发生） |

## 5 个根本张力

| 张力 | 定义 |
|-----|-----|
| 隔离 vs 集成 | n worktree × m files × k interactions → O(nmk) 集成 bug |
| 静态契约 vs 动态发现 | architect 冻结 vs 执行中需协商 |
| 并行速度 vs 语义正确 | "deps passed" ≠ "deps 语义正确" |
| 固定 retry vs 学习 | naive replay 缺 strategy mutation |
| LLM 自由 vs 状态完整性 | tool contracts 过宽允许状态回退 |

---

## 演进阶段（P0 → P5）

每阶段独立，有 specs + benchmark。

### P0 — 地基稳固（current）

**目标**: 消除 tool contract 漏洞，让 LLM 的错误决策**物理上无法**破坏 passed 状态。

**Changes**:
1. `task-agent/agent.ts` — TaskAgentTrigger 合并为 `batch_complete` (带 summary)
2. `task-agent/agent.ts` — `describeTrigger` / `buildSystemPrompt` 去掉 case-specific branches
3. `orchestrator/task-loop.ts` — 所有 trigger 构造改为 `batch_complete`
4. `orchestrator/runtime.ts` — legacy syncRun 路径 trigger 对齐
5. `task-agent/tools.ts` — `execute_goal` 拒绝 passed goals，引导到 `eval_goal` / `modify_goal`
6. `task-agent/tools.ts` — 新增 `retry_failed_goals()` 批量工具

**Success criteria**: benchmark 中不再出现 passed → pending 的状态回退。

**Status**: 🔄 实施中

### P1 — 集成层（Integration Layer）

**目标**: 把 goal-level eval 和 delivery-level eval 之间的 integration gap 填上。

**New concepts**:
- **Milestone**: 跨 goal 的集成单元（e.g. "auth 系统" = goals [auth-schema, auth-endpoint, auth-middleware]）
- **Milestone eval**: 运行 milestone 声明的 integration-check (e.g. "POST /auth/login + GET /diaries 能成功调用")

**DB changes**:
- `orchestrator_milestone` 已存在，但现在 inactive。激活它。
- `goal.milestone_id` 已存在，要求 Requirements Agent 填写。

**Changes**:
1. `decompose/output-tools.ts` — `register_milestone(id, title, integration_check)` Zod tool
2. `decompose/agent.ts` — goal 必须 belong to 一个 milestone
3. `orchestrator/milestone-eval.ts` — new; 在 milestone 全部 goal passed 后运行 integration-check
4. `orchestrator/task-loop.ts` — milestone 完成 → 触发 milestone eval；失败 → retry_context 加 integration-failure evidence
5. `overlay/Board.tsx` — Milestone section 显示

**Success criteria**: 集成 bug 在 milestone eval 抓到，不是 delivery 阶段。

**Status**: ⏸️ 规划

### P2 — Retry 策略进化

**目标**: retry 不是 replay，是 mutate。

**New concepts**:
- **failure_class**: `compilation | test_failure | logic_error | cross_goal_integration | missing_dependency`
- **strategy_hint**: 给 executor 下一次尝试的指导（e.g. `"try-types-first"`, `"extract-abstractions"`, `"test-driven"`）

**Changes**:
1. `evaluator/per-goal.ts` — eval verdict 带 `failure_class` 字段
2. `orchestrator/retry-strategy.ts` — new; 从 prior_attempts + failure_class 选 next strategy_hint
3. `task-agent/tools.ts` — `retry_failed_goal(goalID, reason)` 自动 call retry-strategy
4. `pipeline/executor.ts` — executor prompt 注入 strategy_hint

**Success criteria**: 同一 goal 连续 retry 2 次用不同的 strategy，成功率提升。

**Status**: ⏸️ 规划

### P3 — 可协商契约（Negotiable Contracts）

**目标**: 架构契约可以在执行中被 revise，不是 frozen-at-architect-time。

**New concepts**:
- **Contract version**: architect 写的每个 contract 有 version
- **Contract proposal**: goal 的 executor 可以 `propose_contract_update(contractID, proposal)`
- **Contract arbiter**: Architect Agent 被再次调用 review proposal → 接受/拒绝

**Changes**:
1. `architect/agent.ts` — contracts 带 version 字段
2. `architect/output-tools.ts` — 新增 `propose_contract_update`, `accept_proposal`
3. `task-agent/tools.ts` — 新增工具让 executor 通过 Task Agent 转发 proposal
4. 契约更新后：affected goals 自动 reset + re-dispatch

**Success criteria**: 执行中发现的契约错误可以修复而不用 fail task。

**Status**: ⏸️ 规划

### P4 — Milestone Coordinator 委派

**目标**: 规模扩到 100+ goals，Task Agent attention 不爆炸。

**New concepts**:
- **Milestone Coordinator**: Task Agent 为每个 milestone 派生一个 sub-agent
- **Hierarchical context**: Task Agent 只看 milestone-level summary, Coordinator 看 goal-level 细节

**Changes**:
1. `task-agent/delegation.ts` — new; 阈值判断何时 delegate
2. `task-agent/milestone-coordinator.ts` — new; mini-Task-Agent for a milestone
3. Task Agent 工具改为 `coordinate_milestone(milestoneID)` 替代 `execute_goal` for large tasks

**Success criteria**: 100-goal task 能完成，无 attention overflow。

**Status**: ⏸️ 规划

### P5 — Budget-aware Scheduling

**目标**: 资源消耗可预测 + 可控。

**Changes**:
1. `orchestrator/budget-scheduler.ts` — new; 追踪 tokens / time spent / remaining budget
2. Burn rate > threshold → 降低 concurrency，或转 serial
3. High-risk goals (prior failures) → 分配更少 budget，快速失败

**Success criteria**: budget 耗尽前，大部分 critical goals 已完成。

**Status**: ⏸️ 规划

---

## 修改 new-arch.svg 的节奏

| P | new-arch.svg 更新 |
|---|-------------------|
| P0 | 更新 Task Agent 工具列表（删除 `execute_goal` on passed goals，添加 `retry_failed_goals`） |
| P1 | 增加 Milestone 层图示 + integration-eval box |
| P2 | retry 箭头旁注 "with strategy_hint mutation" |
| P3 | architect 契约 box 加 "versioned, negotiable" |
| P4 | Task Agent 下方加 "Milestone Coordinators" 分层 |
| P5 | Infrastructure 加 Budget Scheduler box |

---

## 验收规则

每个 P 必须：
1. 有独立的 benchmark 验证 success criteria
2. 不破坏前一个 P 的 invariants
3. new-arch.svg 文档更新
4. 通过 `qualityVerdict: "accepted"` + `localVerify exitCode: 0`
5. 无 LLM 决策破坏状态的回退（3/7→2/7 不再发生）
