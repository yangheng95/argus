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
  展开: 需求原文 · 目标映射 · fidelity score

▼ Architect                              ← 新增
  接口契约数 · 目录蓝图 · 导出清单
  展开: 具体接口签名 · 共享类型 · 命名规范

▼ Goal #1 "创建 API 路由"   ✓           ← GoalWorkflowGroup
  ┊ Plan    ✓  5 步骤
  ┊ Execute ✓  worktree #1 · 12 files
  ┊ Eval    ✓  passed · build ✓ test ✓
  展开: plan 步骤 · exec 日志 · eval 证据

▼ Goal #2 "实现前端页面"   ⟳
  ┊ Plan    ✓  3 步骤
  ┊ Execute ⟳  running... worktree #2
  ┊ Eval    ·  pending
  展开: 实时执行进度 · 文件变更流

▼ Goal #3 "添加测试"   ✗
  ┊ Plan    ✓
  ┊ Execute ✓
  ┊ Eval    ✗  failed · test 3/5 passed
  展开: 失败证据 · eval reasoning · retry 状态

▼ Acceptance
  状态 · 变更文件数 · 摘要 · publish 按钮

▼ Interactions (2)
  permission · question · auto-reply 状态

Agent Cards（chat 左侧） — 各 agent 实时消息流
```

**规则**：
- 每个区域可折叠；只有**活跃/失败**的区域默认展开
- Goal 顺序按 dependency layer 排列：Layer 0 在上，Layer 1 在下

## 当前 → 重设计 对照

### 删除的面板区域
| 删除项 | 替代 |
|---|---|
| `SpecPanel` | 合并入 **需求分析区**（spec → requirements） |
| `PlanPanel`（扁平全局） | 拆分到 **GoalWorkflowGroup.plan** 步骤 |
| `GoalsPanel`（扁平列表） | **GoalWorkflowGroup** header 替代 |
| `CriteriaPanel`（全局 checks） | per-goal eval 内嵌（check family 保留在 eval 区） |
| `TaskBoardLane` 泳道 | goals 直接从 `goalWorkflows` 获取，不走 `lane.cards` |

### 新增的面板区域
- **需求分析区** — 需求列表 + 目标数 + 追溯矩阵 + fidelity score
- **Architect 区** — 接口契约 + 目录蓝图 + 导出清单 + 命名规范
- **GoalWorkflowGroup** — per-goal [plan · execute · eval] 可折叠组

### 保留不变
- Overview · Acceptance · Interactions · Agent Cards

## TaskBoard 模型变更

### 新增字段
```ts
workflow: { id, name, currentStep? }      // 当前使用的 workflow

requirements: {                            // 替代 spec
  requirements: Array<{ id, text, type }>,
  traceability: Array<{ reqID, goalIDs }>,
  fidelityScore?: number,
}

architect: {                               // Architect Agent 输出
  decisions: Array<{ key, value, reason, goalIDs }>,
  blueprintSummary?: string,
}

goalWorkflows: Array<GoalWorkflowGroup>    // per-goal 工作流状态
```

### 废弃字段
| 字段 | 替代 |
|---|---|
| `spec: SpecSnapshot` | `requirements` |
| `planNodes: TaskBoardPlanNode[]` | `goalWorkflows[].planSteps` |
| `lanes: TaskBoardLane[]` | 不再需要 |
| `snapshots: ProgressSnapshot[]` | 未使用 |

### 保留字段
`task` · `run` · `goalRuns` · `acceptance` · `evaluation` · `interactions` · `overview` · `brief` · `artifacts`

## 配置面板重设计

按关注点分组，匹配 `EngineConfig`：

```
▼ Connection
  Server URL · Password · Username · 连接状态 · 自动重连

▼ Appearance
  Theme (dark/light/system) · Opacity · Zoom
  Always on Top · Locale (zh-CN/en-US)
  注：Overlay 的 Locale 偏好属 Layer 2（localStorage，只控前端文案）。
      2026-05-11 新增的顶层 `config.locale`（zh-CN / en-US）是 Layer 1 的
      assistant reply language，独立于此处的 UI Locale。

▼ Workflow                                ← 新增
  Default Workflow: [pipeline ▾]   (built-in IDs: direct · pipeline)

▼ Agent Config                            ← 新增
  ├ Requirements    max_steps  skills[]
  ├ Architect       max_steps  skills[]
  ├ Frontend Design  max_steps  skills[]
  ├ Intent-Analysis max_steps  skills[]
  ├ Build           max_steps  skills[]
  └ Acceptance        max_steps  max_retries  skills[]
  注：实际默认 max_steps = 1000（见 `engine/config.ts:170-212`）；schema 中没有
      `timeout_ms` / `quality_threshold` / `max_attempts` 字段（这些字段在
      2026-05-12 sync 中随 assistant.spec / planner / evaluator 一同删除）。
      acceptance_visual{} 是数值硬门槛阈值，不在 agent 行内展示。
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

| 事件 | 触发 |
|---|---|
| `workflow.selected` | 更新 workflow 标识 |
| `workflow.step.updated` | 刷新 stage（requirements / architect / build / acceptance 等步骤进度） |
| `goal.workflow.progress` | per-goal workflow 进度 |

> 历史版本规划过 `requirements.completed` / `architect.completed` / `goal.workflow.updated` 等
> 独立事件，当前**均未注册**——stage 进度统一通过 `workflow.step.updated` + `goal.workflow.progress`
> 推。`GoalWorkflowGroup` 通过现有 `goal.*` 与 task board 重编译事件驱动刷新即可。

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
