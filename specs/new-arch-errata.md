# new-arch.svg 勘误与修正

本文件记录 `new-arch.svg` 架构文档中与当前代码实现的偏差。
当 SVG 与本文件冲突时，以本文件为准。

---

## Section A/B: Agent 命名

### 修正 1: Requirements Agent 目录路径

**SVG 描述**: `requirements/agent.ts`, `requirements/fidelity.ts`
**实际状态**: 内部实现仍在 `decompose/` 目录，通过 `requirements/index.ts` barrel re-export。

```
公共 API:  @/requirements  (RequirementsAgent, RequirementsService, ...)
内部实现:  @/decompose/    (DecomposeAgent, DecomposeService, ... 保留 git history)
```

消费者应通过 `@/requirements` 导入。`@/decompose` 视为内部路径。

---

## Section C: Task Agent Tools

### 修正 2: 工具名已从 `decompose` 改为 `requirements`

**SVG 描述**: `requirements(request)` — 括号内有 `request` 参数
**实际状态**: 工具名为 `requirements`，参数只有 `reason?: string`（无 request 参数，request 从 task row 读取）

### 修正 3: `restart_from_stage` 的 stage enum

**SVG 描述**: 未明确列出
**实际状态**: stage 从 `"decompose"` 改为 `"requirements"`

---

## Section F: Unified Config

### 修正 4: `stage_max_retries` 已移除

**SVG 描述**: 在删除清单中标记删除 `stage_max_retries`
**实际状态**: 已从 `OrchestratorConfigType` 中移除。原功能（LLM API 瞬态故障重试）保留为 `strategy.ts` 内部常量 `LLM_TRANSIENT_RETRIES = 2`，不再通过用户配置暴露。

### 修正 5: spec 是"复用"不是"替换"

**SVG 描述**: "spec 已被 requirements 替代"
**实际状态**: requirements 工具的输出仍然存储为 `SpecSnapshot`（通过 `OrchestratorSpecSnapshotTable`）。`task.active_spec_version_id` 仍是核心字段。这是**复用 spec 存储**，不是替换。

TaskBoard 中 `spec` 字段保留且仍被填充。新增的 `requirements` 字段是从 `OrchestratorRequirementTable` 读取的结构化需求列表，作为 spec 的补充视图。

---

## Section I: Mini Workflow

### 修正 6: 移除 `auto_select` 字段

**SVG 描述**: `MiniWorkflow` 包含 `auto_select?: string`（自然语言条件）
**实际状态**: 未实现。Task Agent 的 workflow 选择基于 `task.metadata._workflow?.workflowID` 或 `OrchestratorConfig.default_workflow`，不需要自然语言匹配。

### 修正 7: 移除 `auto_select_workflow` 配置

**SVG 描述**: `assistant.auto_select_workflow: boolean`
**实际状态**: 未实现。workflow 选择逻辑不需要此开关。

---

## Section J: Panel Architecture

### 修正 8: SSE 事件名称统一

**SVG 描述**:
```
requirements.completed → 刷新需求分析区
architect.completed    → 刷新 architect 区
workflow.selected      → 更新 workflow 标识
goal.workflow.updated  → 刷新 GoalWorkflowGroup
```

**实际实现**:
```
workflow.selected         → { taskID, workflowID, workflowName, summary }
workflow.step.updated     → { taskID, stepID, goalID?, status, summary }
goal.workflow.progress    → { taskID, goalID, completedSteps, totalSteps, currentStep?, summary }
```

`requirements.completed` 和 `architect.completed` 是冗余的——`workflow.step.updated` 在工具完成时自动发射，已覆盖这些场景。不额外实现。

### 修正 9: Overlay 面板当前仍为旧架构

文档 Section J 描述的是目标态面板布局。当前 Board.tsx 仍使用旧的 Spec/Goals/Plan/Criteria 扁平 section。TaskBoard schema 中的新字段（workflow, requirements, architect, goalWorkflows）已在后端填充，但 overlay 组件尚未消费。

**待实现组件**:
- WorkflowProgressBar
- GoalWorkflowGroup
- RequirementsPanel
- ArchitectPanel
- OrchestrationPanel (设置)

---

## 实现状态总览

| SVG Section | 状态 | 备注 |
|-------------|------|------|
| A: Agent Hierarchy | ✅ 已实现 | 目录重命名通过 barrel re-export |
| B: Code Architecture | ✅ 已实现 | 路径修正见修正1 |
| C: Task Agent Behavior | ✅ 已实现 | 工具名 requirements，step tracking |
| D: Multi-Task Queue | ✅ 已实现 | 无变化 |
| E: Anti-Patterns | ✅ 已实现 | stage_max_retries 已从配置移除 |
| F: Unified Config | ⚠️ 部分 | PanelSettings 已删，spec 是复用非替换 |
| G: LLM Provider | ✅ 已实现 | 无变化 |
| H: Architect + RecommendedNext | ✅ 已实现 | 无变化 |
| I: Mini Workflow | ✅ 已实现 | 移除 auto_select，类型/registry/tracking 完成 |
| J: Panel Architecture | ❌ 待实现 | 后端就绪，overlay 组件未创建 |
