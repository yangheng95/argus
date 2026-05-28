# 数据模型：Task / Goal / Plan / Artifact

所有 engine 域表定义集中在 `packages/opencorvus/src/engine/engine.sql.ts`，命名前缀统一为 `engine_*`（历史上的 `orchestrator_*` 已全部重命名）。

> **2026-05 关键变更**：Phase 6 把 5 张过程表（`engine_run` / `engine_goal_run` / `engine_delivery` / `engine_evaluation` / `engine_goal_snapshot`）**合并为单一 `engine_artifact` 表**，按 `kind` 字段区分语义。如果你来自旧文档对 "Run / GoalRun / Evaluation / Delivery 是独立表" 的认知，这里全部失效。

## 概念关系

```
Task (kind: "workflow" | "build")
 └─ PlanVersion (version 1, 2, ... ；status ∈ {active, superseded})
     ├─ Goal[]                ← 深度分解的目标
     ├─ Milestone[]           ← 验收里程碑（pending / active / passed / failed）
     ├─ Requirement[]         ← 需求追溯
     └─ PlanNode[]            ← 计划步骤

Artifact[]   (run / goal_run_attempt / delivery / verification-evidence / verdict / patch / …)
SpecSnapshot · SpecItem        ← requirements 输出
InteractionRequest             ← permission / question
ChannelBinding                 ← 外部 channel ↔ task 绑定
ProgressSnapshot · ExecutorSession ← 进度与 executor 句柄
```

13 张表完整列表见 [02-data.md](../../../specs/new-arch/02-data.md#engine-域13-张表)。

## 各实体速览

### Task（`engine.sql.ts` · `EngineTaskTable`）

| 字段         | 说明                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| `kind`       | `"workflow"`（默认；走完整 Task Control Loop）或 `"build"`（直接跑 build agent，跳过分解 / 计划 / 评估） |
| `status`     | `queued / active / completed / failed / cancelled`                                                       |
| `priority`   | `critical / high / normal / low`                                                                         |
| `session_id` | 指向 root session                                                                                        |

一个 Task 可能经历多个 PlanVersion（每次 replan 产生新版，旧的置 `superseded`）。

### PlanVersion（`EnginePlanVersionTable`）

- `version`：递增序号
- `status`：`active` / `superseded`
- `spec_snapshot_id`：关联当时的 SpecSnapshot
- 每次 replan / restart_from_stage 生成新版

### Goal（`EngineGoalTable`）

最小可并行、可独立验收的实现单元。

Architect 分解必须先分析需求表面、实现责任、验证责任、依赖与集成风险，再提交 goal 图。有效工作流至少包含 2 个 goal；单个 all-in-one 大型 goal 不合格，因为它无法提供可靠的独立执行与独立验收边界。

| 字段                      | 说明                                               |
| ------------------------- | -------------------------------------------------- |
| `title` / `objective`     | 目标名与叙述                                       |
| `done_definition`         | 验收标准（可含可执行命令：`bun run typecheck` 等） |
| `owned_paths[]`           | 本 Goal 负责的代码路径                             |
| `depends_on[]`            | 前置 Goal（拓扑排序依据）                          |
| `priority`                | `blocking` 或 `advisory`                           |
| `exports[]` / `imports[]` | Goal 间数据契约                                    |

> **Goal 表已无 `status` 列**——live 状态由 `engine/describe.ts::goalStatusByID` 派生（2026-05-05 Phase E 退役）。
>
> **Goal 表已无 `workspace_dir` / `workspace_branch` / `workspace_base_ref` / `retry_count` / `cascade_state`**——这些迁到了 `engine_artifact[kind="goal_run_attempt"].payload`（单源），通过 `engine/store.ts::findGoalLatestWorkspace` / `getGoalRetryCount` 读取。

### Milestone（`EngineMilestoneTable`）

按 `status ∈ {pending, active, passed, failed}` 推进。Requirements / Architect / Delivery 之间用 milestone 串联交付节点。

### Requirement（`EngineRequirementTable`） / SpecItem（`EngineSpecItemTable`）

由 `requirements` agent 写入，作为 fidelity 评估的追溯锚点。

### Artifact（`EngineArtifactTable` · 统一过程表）

`kind` 决定语义。完整 `EngineArtifactKind` 取值（`engine.sql.ts:97`）：

```
run · goal_run_attempt · delivery · verification-evidence · evaluation ·
verdict · patch · changed_file · diff · log · report · image · link ·
git_ref · pr · integrity_attempt · prosecutor_attempt ·
delivery_evidence_manifest · delivery_surface_manifest ·
delivery_specialist_review · delivery_verification_threw ·
orchestrator-stream-error
```

**常见 kind 含义**：

| kind                                                                    | 含义                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `run`                                                                   | 一次 Task 执行尝试的根节点（取代旧 `engine_run` 表）                            |
| `goal_run_attempt`                                                      | 单个 Goal 的一次 worktree 尝试，`payload.workspace_*` 为单源 worktree 信息      |
| `delivery`                                                              | 一次交付候选（取代旧 `engine_delivery` 表）                                     |
| `evaluation` / `verdict`                                                | 评估判决（`accepted / rejected / inconclusive`；取代旧 `engine_evaluation` 表） |
| `verification-evidence`                                                 | delivery 检查证据（含 scope = `goal_run` / `delivery`）                         |
| `patch` / `changed_file` / `diff`                                       | 代码变更产物                                                                    |
| `delivery_evidence_manifest` / `surface_manifest` / `specialist_review` | delivery 阶段产物                                                               |
| `integrity_attempt` / `prosecutor_attempt`                              | integrity / prosecutor agent 输出                                               |

`inconclusive` verdict 语义为"无法判决"——不是通过也不是失败，触发 replan 而非 retry。

### InteractionRequest（`EngineInteractionRequestTable`）

`type ∈ {permission, question}`。permission 用于 tool 权限审批，question 用于 agent 主动询问用户。

### ChannelBinding（`EngineChannelBindingTable`）

外部 channel（platform / channel / thread）↔ task 绑定；`ChannelIngress` 据此把外部回复路由到对应任务。

### SpecSnapshot（`EngineSpecSnapshotTable`）

| 字段         | 说明                       |
| ------------ | -------------------------- |
| `summary`    | 一句话规格                 |
| `content`    | 完整规格（Markdown）       |
| `scope`      | 涉及的文件 / 模块范围      |
| `evidence[]` | 产出规格所依据的代码证据链 |

## Session 域

`packages/opencorvus/src/session/session.sql.ts` 5 张表：`session` · `message` · `part` · `todo` · `permission`。

**SessionKind**（固定在 creation time，`session.sql.ts:50-65` 出现顺序）：

```
root · orchestrator · assistant · mission · intent-analysis ·
requirements · design-analyst · goal · architect · integrity ·
delivery · executor · build · evaluator · system
```

共 **15 种**。`planner` 已删除，**不再是合法的 SessionKind**。

`session.goal_id` 字段：当 session 归属某个 goal（`executor` / `build` session）时写入，overlay 据此把消息嵌在 goal 卡片下。

## 唯一写入者

**禁止其他模块直接写 `engine_*` 表**。唯一允许的写入路径：

- `task-api/index.ts`（`EngineService.*` 入口）
- `engine/persist.ts` / `engine/state.ts` / `engine/store.ts`

读路径在 `engine/describe.ts` / `engine/store.ts` 暴露 query helper。

## 状态持久化

所有状态存 SQLite（默认 `~/.opencorvus/opencorvus.db`），支持跨进程 / 跨会话恢复。Task 崩溃后重启 server 可继续执行——`EngineService.init` 的串行队列 recovery 会把孤儿 task 统一重启（不再有旧的 `recoverOrphanedTasks` fire-and-forget 路径）。

## 你接下来要看的

- [架构总览](./architecture.md)
- [Agentic Loop](./agent-loop.md)
- [Delivery 检查与判决](../opencorvus/evaluator.md)
- 完整数据面规范：[specs/new-arch/02-data.md](../../../specs/new-arch/02-data.md)
