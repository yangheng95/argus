# 07 — Panel 架构

> 对应代码：`src/panel/capability.ts` · `src/control/message.ts` · `src/workbench/` ·
> `src/server/routes/panel.ts` · `packages/overlay/src/`（前端）
>
> 注：`panel/api.ts` 和 `panel/settings.ts` 已删除。Panel 的 HTTP 入口现在是
> `server/routes/panel.ts` → `ControlMessage.handle`；对话层白名单 action 定义在
> `panel/capability.ts`。

## 设计原则

- 面板按 **Workflow 结构**组织，不是扁平罗列
- Per-goal 进度可见（每个 goal 是可折叠的 `GoalWorkflowGroup`）
- 配置面板按关注点分组，匹配 `EngineConfig`

## 右侧信息面板

### 布局（自上而下）

```
┌─ TASK HEADER ────────────────────────────────────┐
│  标题 · 状态 · 当前 Workflow · 耗时               │
└──────────────────────────────────────────────────┘

▼ Overview
  headline · nextStep · controls (retry/cancel)

▼ 需求分析                               ← 替代 SpecPanel
  需求列表 (REQ-1...N) · 目标数 · 追溯矩阵
  展开: 需求原文 · 类型 · 优先级 · 状态

▼ Architect
  接口契约数 · 目录蓝图 · 导出清单
  展开: 具体接口签名 · 共享类型 · 命名规范

▼ Goal #1 "创建 API 路由"   ✓           ← GoalWorkflowGroup
  ┊ Executor ✓  worktree #1 · 12 files · Build ✓
  展开: planNodes · build session · diff stats · checks

▼ Goal #2 "实现前端页面"   ⟳
  ┊ Executor ⟳  running... worktree #2 · Build ⟳
  展开: 实时执行进度 · 文件变更流

▼ Goal #3 "添加测试"   ✗
  ┊ Executor ✗  failed · test 3/5 passed
  展开: buildOutcome · failed checks · retry 状态

▼ Acceptance
  状态 · 变更文件数 · 摘要 · publish 按钮

▼ Interactions (2)
  permission · question · auto-reply 状态

Agent Cards（chat 左侧） — 各 agent 实时消息流
```

**规则**：

- 每个区域可折叠；只有**活跃/失败**的区域默认展开
- Goal 顺序按 dependency layer 排列：Layer 0 在上，Layer 1 在下

## Current Surface Ownership

### Retired Surfaces

| 删除项                         | 替代                                              |
| ------------------------------ | ------------------------------------------------- |
| `SpecPanel`                    | 合并入 **需求分析区**（spec → requirements）      |
| `PlanPanel`（扁平全局）        | **Executor** step payload 的 `planNodes`           |
| `GoalsPanel`（扁平列表）       | **GoalWorkflowGroup** header 替代                 |
| `CriteriaPanel`（全局 checks） | `criteriaResults` + per-goal Executor checks      |
| `TaskBoardLane` 泳道           | goals 直接从 `goalWorkflows` 获取，不走旧泳道卡片 |

### Active Workflow Surfaces

- **需求分析区** — 需求列表 + 目标数 + 类型 / 优先级 / 状态
- **Architect 区** — 接口契约 + 目录蓝图 + 导出清单 + 命名规范
- **GoalWorkflowGroup** — per-goal `build` / `Executor` 可折叠组

### Stable Surfaces

- Overview · Acceptance · Interactions · Agent Cards

## TaskBoard Model

### Top-Level Fields

```ts
{
  lastSequence?: number,
  snapshotVersion: string,
  task: Task,
  spec?: SpecSnapshot,
  plan?: PlanVersion,
  run?: Run,
  acceptance?: Acceptance,
  candidateAcceptance?: Acceptance,
  acceptedAcceptance?: Acceptance,
  evaluation?: Evaluation,
  interactions: Interaction[],
  channels: TaskChannelBinding[],
  artifacts: Artifact[],
  overview: TaskBoardOverview,
  brief: { content: string, updated_at: number },
  workflow?: TaskBoardWorkflow,
  requirements?: TaskBoardRequirement[],
  architect?: TaskBoardArchitect,
  goalWorkflows?: TaskBoardGoalWorkflow[],
  criteriaResults?: EvaluationCheck[],
}
```

### Workflow Fields

```ts
workflow?: {                              // 当前使用的 workflow
  id: string,
  name: string,
  steps: Array<{
    id: string,
    orderKey: string,
    label: string,
    tool: string,
    scope: "task" | "goal",
    skippable: boolean,
    status: "pending" | "running" | "completed" | "skipped" | "failed" | "aborted",
    phases?: Array<{
      id: string,
      label: string,
      sessionKind: string,
    }>,
  }>,
  goalLoopStepIDs: string[],
}

requirements?: Array<{                     // Requirements Agent 输出
  id: string,
  description: string,
  type: "explicit" | "inferred" | "system",
  priority: "blocking" | "advisory",
  status: "pending" | "passed" | "failed",
}>

architect?: {                              // Architect Contract Graph 摘要
  summary: string,
  contractCount: number,
  categories: string[],
  decisions?: Array<{
    key: string,
    value: string,
    reason: string,
    goalID: string | null,
  }>,
}

goalWorkflows?: Array<{
  goalID: string,
  goalRunID?: string,
  orderKey: string,
  goalTitle: string,
  goalObjective?: string,
  goalStatus: string,
  orderIndex: number,
  workspaceDir?: string,
  workspaceBranch?: string,
  retryCount: number,
  priority: "blocking" | "advisory",
  steps: Array<{
    stepID: string,
    orderKey: string,
    label: string,
    status: "pending" | "running" | "completed" | "skipped" | "failed" | "aborted",
    startedAt?: number,
    completedAt?: number,
    summary?: string,
    payload?: {
      planNodes?: Array<{
        id: string,
        title: string,
        brief: string,
        orderIndex: number,
        fileActions?: Array<{ path: string, intent: string }>,
        verificationCommands?: Array<{ command: string, purpose: string }>,
      }>,
      buildSessionID?: string,
      commitRef?: string,
      publishedCommitRef?: string,
      diffBaseRef?: string,
      diffHeadRef?: string,
      changedFiles?: string[],
      attemptChangedFiles?: string[],
      attemptCommitRef?: string,
      attemptPublishedCommitRef?: string,
      changedFileDiffs?: Array<{ file: string, additions: number, deletions: number, status: "added" | "deleted" | "modified" }>,
      diffStats?: { files?: number, additions?: number, deletions?: number },
      buildOutcome?: {
        id: string,
        goalRunID: string,
        terminalStatus: "completed" | "failed" | "aborted",
        outcomeKind: "delivered" | "failed" | "aborted" | "no_project_diff",
        acceptancePresent: boolean,
        summary?: string,
        error?: string,
        noDiffReason?: string,
        changedFiles: string[],
        commitRef?: string,
        publishedCommitRef?: string,
        diffBaseRef?: string,
        diffHeadRef?: string,
      },
      checks?: Array<{ name: string, status: string, evidence?: string, family?: string }>,
      evalSummary?: string,
      verdict?: string,
    },
    phases?: Record<string, {
      orderKey: string,
      status: "pending" | "running" | "completed" | "skipped" | "failed" | "aborted",
      startedAt?: number,
      completedAt?: number,
    }>,
  }>,
  contracts?: Array<{ key: string, value: string, reason?: string }>,
  acceptanceSpecs?: AcceptanceSpec[],
}>                                           // per-goal 工作流状态
```

`changedFiles` / `commitRef` / `publishedCommitRef` describe files accepted into
the delivered/published result. `attemptChangedFiles` / `attemptCommitRef` /
`attemptPublishedCommitRef` describe terminal Build-attempt host facts when the
attempt failed, aborted, or produced no accepted delivery. Debug copy uses both
counts so a failed attempt with file changes is not shown as `changedFiles=0`.

### 废弃字段

| 字段                             | 替代                                        |
| -------------------------------- | ------------------------------------------- |
| `spec: SpecSnapshot`             | `requirements`                              |
| `planNodes: TaskBoardPlanNode[]` | `goalWorkflows[].steps[].payload.planNodes` |
| `lanes: TaskBoardLane[]`         | 不再需要                                    |
| `snapshots: ProgressSnapshot[]`  | 未使用                                      |

### 保留字段

`lastSequence` · `snapshotVersion` · `task` · `spec` · `plan` · `run` · `acceptance` ·
`candidateAcceptance` · `acceptedAcceptance` · `evaluation` · `interactions` · `channels` ·
`artifacts` · `overview` · `brief` · `workflow` · `requirements` · `architect` ·
`goalWorkflows` · `criteriaResults`

## Configuration Panel

按关注点分组，匹配 `EngineConfig`：

```
▼ Connection
  Server URL · Password · Username · 连接状态 · 自动重连

▼ Appearance
  Theme (dark/light/system) · Zoom · Locale (zh-CN/en-US)
  注：Overlay 的 Locale 偏好属 Layer 2（localStorage，只控前端文案）。
      顶层 `config.locale`（zh-CN / en-US）是 Layer 1 的
      assistant reply language，独立于此处的 UI Locale。

▼ Workflow
  Default Workflow: [pipeline ▾]   (built-in IDs: direct · pipeline)

▼ Agent Config
  ├ Requirements    max_steps  skills[]
  ├ Architect       max_steps  skills[]
  ├ Frontend Design  max_steps  skills[]
  ├ Intent-Analysis max_steps  skills[]
  ├ Build           max_steps  skills[]
  └ Acceptance Visual thresholds
  注：实际默认 max_steps = 1000（见 `engine/config.ts:170-212`）；schema 中没有
      `timeout_ms` / `quality_threshold` / `max_attempts` 字段（这些字段在
      随 assistant.spec / planner / evaluator 一同删除）。
      acceptance_visual{} owns numeric visual evidence thresholds and is not shown as an agent row.
      activity{} 的 stream-idle / executor-events-idle / task-queue-run-timeout
      是 host 层 watchdog，归 Orchestration 而非 Agent Config。
  每个 agent 可展开: skills[] · model 选择
  → PATCH /config { assistant: { architect: { ... } } }
  注：planner / acceptance review 已下线（详见 [01-agents.md](01-agents.md)）。

▼ Orchestration
  max_executor_groups: 3

▼ Behavior                                ← 来自 Config.Info.experimental
  Auto-question
  注：unattended / auto_permission 配置项已删除，仅保留 auto_question。

▼ Model / Provider
  Per-agent 模型选择
  Provider 列表 · API Key 状态

▼ Advanced
  Show Transcript Details · MCP Timeout · Prompt Catalog
  Channel 管理 (Slack/Discord/...)
```

**配置变更路径**：

```
Panel → PATCH /config {partial} → mergeDeep → 写文件
     → Bus "config.changed" → SSE → 所有 Overlay 自动刷新
```

## SSE 事件扩展

实际注册的事件（见 `engine/model.ts:1067-1069`）：

| 事件                     | 触发                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| `workflow.selected`      | 更新 workflow 标识                                                     |
| `workflow.step.updated`  | 刷新 workflow step 状态（requirements / architect / build / visual_qa / integrity 等） |
| `goal.workflow.progress` | per-goal workflow 进度                                                 |

> 历史版本规划过 `requirements.completed` / `architect.completed` / `goal.workflow.updated` 等
> 独立事件，当前**均未注册**——stage 进度统一通过 `workflow.step.updated` + `goal.workflow.progress`
> 推。`GoalWorkflowGroup` 通过 `goal.workflow.progress`、`workflow.step.updated` 与 task board 重编译事件驱动刷新。

## 后端对接

- `src/workbench/board.ts` — `compileBoard` 构造 TaskBoard 视图
- `src/workbench/brief.ts` — 简报编译
- `src/workbench/note-store.ts` — per-task 备注
- `src/workbench/workbench.sql.ts` — `workbench_task_note` · `workbench_brief_snapshot`
- `src/server/routes/panel.ts` — 面板 HTTP 入口 → `ControlMessage.handle / handleStream`
- `src/panel/capability.ts` — 面板 capability 白名单（对话层 LLM 可产出的 action）
- `src/task-api/index.ts` — Capability action 最终路由到的 `EngineService` API

## 相关文档

- [05-config.md](05-config.md) — Config.Info 层级与 PATCH 协议
- [02-data.md](02-data.md) — workbench 表结构
- [01-agents.md](01-agents.md) — GoalWorkflowGroup 对应的 agent 输出
