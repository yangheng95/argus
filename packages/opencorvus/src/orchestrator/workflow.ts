/**
 * MiniWorkflow — 可插拔工作流声明式模板
 *
 * MiniWorkflow 是一组有序 agent 步骤的声明式模板。
 * 不是状态机，不是固定 pipeline，不是 workflow engine。
 * Task Agent 的 versatility 来自用户输入 — 输入决定走哪条 workflow。
 * 一旦输入被转换为 goals，MiniWorkflow 提供"推荐路径"。
 * Task Agent 仍可跳步或偏离。
 *
 * 每个步骤都是 Task Agent 的一个已有工具 —
 * 即使在 workflow 外也可以被单独调用。
 */
import { OrchestratorConfig } from "./config"

// ═══════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════

/** 工作流中的一个步骤 — 映射到 Task Agent 的一个工具 */
export interface MiniWorkflowStep {
  /** 步骤唯一 ID (e.g., "requirements", "architect", "plan", "execute", "eval", "deliver") */
  id: string
  /** 对应的 Task Agent 工具名 (e.g., "requirements", "architect", "plan_goal", "execute_goal", "eval_goal", "deliver") */
  tool: string
  /** UI 显示名 */
  label: string
  /** 注入 system prompt 的简短指引 */
  hint: string
  /** task = 整个任务执行一次, goal = 每个 goal 执行一次 */
  scope: "task" | "goal"
  /** Task Agent 能否跳过此步骤 */
  skippable: boolean
  /** 前置步骤 ID（声明式依赖，非强制约束） */
  after: string[]
}

/** 一个完整的可插拔工作流模板 */
export interface MiniWorkflow {
  /** 工作流唯一 ID (e.g., "standard", "quick-fix", "plan-only") */
  id: string
  /** 显示名称 */
  name: string
  /** 一句话说明何时使用 */
  description: string
  /** 有序步骤序列。顺序 = 推荐执行顺序，非强制。 */
  steps: MiniWorkflowStep[]
  /** 哪些 step ID 构成 per-goal 循环（用于 UI 分组） */
  goalLoopStepIDs: string[]
}

/** Per-goal 步骤状态 */
export interface GoalStepStatus {
  status: "pending" | "running" | "completed" | "skipped" | "failed"
  startedAt?: number
  completedAt?: number
}

/** Per-goal 工作流状态（用于 TaskBoard + UI 渲染） */
export interface GoalWorkflowState {
  goalID: string
  goalTitle: string
  goalStatus: string
  steps: Record<string, GoalStepStatus>
}

/** 任务级工作流追踪状态，存储在 task.metadata._workflow */
export interface WorkflowState {
  /** 当前使用的 workflow ID */
  workflowID: string
  /** 当前预期的下一步骤 ID（用于 system prompt 标注 [CURRENT]） */
  currentStepID: string | null
  /** task-scope 步骤状态 */
  taskSteps: Record<string, GoalStepStatus>
  /** per-goal 步骤状态 */
  goalSteps: Record<string, GoalWorkflowState>
}

// ═══════════════════════════════════════════════════════════════════
// 内置 Workflow 定义
// ═══════════════════════════════════════════════════════════════════

/** standard — 完整开发流程（默认） */
const STANDARD: MiniWorkflow = {
  id: "standard",
  name: "Standard",
  description: "完整 requirements → architect → per-goal execute → deliver 流程（planning 在 goal 内部自动进行，delivery agent 做最终验收）",
  steps: [
    {
      id: "requirements",
      tool: "requirements",
      label: "Requirements",
      hint: "分析输入，提取需求，分解为可执行的 goals with acceptance criteria。",
      scope: "task",
      skippable: false,
      after: [],
    },
    {
      id: "architect",
      tool: "architect",
      label: "Architect",
      hint: "多 goal 时协调跨目标共识：接口契约、目录蓝图、导出清单。单 goal 可跳过。",
      scope: "task",
      skippable: true,
      after: ["requirements"],
    },
    {
      id: "execute",
      tool: "execute_goal",
      label: "Execute",
      hint: "在隔离 worktree 中执行 goal 实现（含自动 planning）。执行器自报成功/失败。",
      scope: "goal",
      skippable: false,
      after: ["architect"],
    },
    {
      id: "deliver",
      tool: "deliver",
      label: "Deliver",
      hint: "聚合交付物，delivery agent 端到端测试、修复、验收、发布。",
      scope: "task",
      skippable: false,
      after: ["execute"],
    },
  ],
  goalLoopStepIDs: ["execute"],
}

/** quick-fix — 极简修复 */
const QUICK_FIX: MiniWorkflow = {
  id: "quick-fix",
  name: "Quick Fix",
  description: "极简流程：快速分析 → 直接执行 → 验证发布",
  steps: [
    {
      id: "requirements",
      tool: "requirements",
      label: "Analyze",
      hint: "快速分析，创建单 goal。简单任务可跳过。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "execute",
      tool: "execute_goal",
      label: "Execute",
      hint: "直接执行修复。",
      scope: "goal",
      skippable: false,
      after: ["requirements"],
    },
    {
      id: "deliver",
      tool: "deliver",
      label: "Deliver",
      hint: "验证并发布。",
      scope: "task",
      skippable: false,
      after: ["execute"],
    },
  ],
  goalLoopStepIDs: ["execute"],
}

/** plan-only — 研究与设计 */
const PLAN_ONLY: MiniWorkflow = {
  id: "plan-only",
  name: "Plan Only",
  description: "仅分析和规划，不执行代码：requirements → architect → plan",
  steps: [
    {
      id: "requirements",
      tool: "requirements",
      label: "Requirements",
      hint: "分解需求和目标。",
      scope: "task",
      skippable: false,
      after: [],
    },
    {
      id: "architect",
      tool: "architect",
      label: "Architect",
      hint: "协调跨目标契约。",
      scope: "task",
      skippable: true,
      after: ["requirements"],
    },
  ],
  goalLoopStepIDs: [],
}

// ═══════════════════════════════════════════════════════════════════
// 内置 Workflow 注册表
// ═══════════════════════════════════════════════════════════════════

const BUILT_IN: Record<string, MiniWorkflow> = {
  "standard": STANDARD,
  "quick-fix": QUICK_FIX,
  "plan-only": PLAN_ONLY,
}

// ═══════════════════════════════════════════════════════════════════
// WorkflowRegistry — 查询 + 解析
// ═══════════════════════════════════════════════════════════════════

export namespace WorkflowRegistry {
  /** 所有内置 workflow（用于展示 / 文档） */
  export const builtIn: Readonly<Record<string, MiniWorkflow>> = BUILT_IN

  /**
   * 按 ID 解析 workflow。
   * 优先级：用户自定义（config.assistant.workflows）> 内置。
   */
  export async function resolve(workflowID: string): Promise<MiniWorkflow | undefined> {
    const cfg = await OrchestratorConfig.get()
    const userDefined = cfg.workflows?.find((w: MiniWorkflow) => w.id === workflowID)
    if (userDefined) return userDefined
    return BUILT_IN[workflowID]
  }

  /** 列出所有可用 workflow（内置 + 用户自定义，按 ID 去重）。 */
  export async function list(): Promise<MiniWorkflow[]> {
    const cfg = await OrchestratorConfig.get()
    const userWorkflows = cfg.workflows ?? []
    const userIDs = new Set(userWorkflows.map((w: MiniWorkflow) => w.id))
    const builtInList = Object.values(BUILT_IN).filter(w => !userIDs.has(w.id))
    return [...builtInList, ...userWorkflows]
  }

  /** 获取默认 workflow ID */
  export async function defaultID(): Promise<string> {
    const cfg = await OrchestratorConfig.get()
    return cfg.default_workflow ?? "standard"
  }

  /** 同步获取内置 workflow（不读取 config） */
  export function resolveSync(workflowID: string): MiniWorkflow | undefined {
    return BUILT_IN[workflowID]
  }
}

// ═══════════════════════════════════════════════════════════════════
// Workflow State 工厂
// ═══════════════════════════════════════════════════════════════════

/** 根据 workflow 定义创建初始 WorkflowState */
export function createWorkflowState(workflow: MiniWorkflow): WorkflowState {
  const taskSteps: Record<string, GoalStepStatus> = {}
  for (const step of workflow.steps) {
    if (step.scope === "task") {
      taskSteps[step.id] = { status: "pending" }
    }
  }
  const firstStep = workflow.steps[0]
  return {
    workflowID: workflow.id,
    currentStepID: firstStep?.id ?? null,
    taskSteps,
    goalSteps: {},
  }
}

/** 为一个新 goal 初始化 per-goal 步骤状态 */
export function createGoalStepStates(workflow: MiniWorkflow): Record<string, GoalStepStatus> {
  const steps: Record<string, GoalStepStatus> = {}
  for (const step of workflow.steps) {
    if (step.scope === "goal") {
      steps[step.id] = { status: "pending" }
    }
  }
  return steps
}

/** 根据 tool 名查找 workflow 中对应的 step */
export function findStepByTool(workflow: MiniWorkflow, toolName: string): MiniWorkflowStep | undefined {
  return workflow.steps.find(s => s.tool === toolName)
}

/**
 * 渲染 workflow 为 system prompt 文本。
 * 每个步骤标注 [DONE] / [CURRENT] / [PENDING] / [SKIPPED] / [FAILED]。
 */
export function renderWorkflowPrompt(workflow: MiniWorkflow, state: WorkflowState): string {
  const lines: string[] = []
  lines.push(`## Recommended Workflow: ${workflow.name}`)
  lines.push("")

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i]
    const num = i + 1
    const skip = step.skippable ? " (可跳过)" : ""

    // 确定状态标签
    let statusTag = "[PENDING]"
    if (step.scope === "task") {
      const ts = state.taskSteps[step.id]
      if (ts) {
        statusTag = statusLabel(ts.status)
      }
    } else {
      // goal-scope: 如果任意 goal 在跑就算 running，全部 done 算 done
      const goalEntries = Object.values(state.goalSteps)
      if (goalEntries.length > 0) {
        const statuses = goalEntries.map(g => g.steps[step.id]?.status ?? "pending")
        if (statuses.some(s => s === "running")) statusTag = "[RUNNING]"
        else if (statuses.every(s => s === "completed" || s === "skipped")) statusTag = "[DONE]"
        else if (statuses.some(s => s === "failed")) statusTag = "[FAILED]"
        else if (statuses.some(s => s === "completed")) statusTag = "[PARTIAL]"
      }
    }

    if (step.id === state.currentStepID && statusTag === "[PENDING]") {
      statusTag = "[CURRENT]"
    }

    lines.push(`${num}. [${step.scope}] ${step.tool} — ${step.hint}${skip} ${statusTag}`)
  }

  if (workflow.goalLoopStepIDs.length > 0) {
    const loopLabels = workflow.goalLoopStepIDs
      .map(id => workflow.steps.find(s => s.id === id)?.label ?? id)
      .join(" → ")
    lines.push("")
    lines.push(`Per-goal 步骤 [${loopLabels}] 对每个 goal 重复执行。`)
  }

  lines.push("")
  lines.push("NOTE: 这是推荐路径，不是固定 pipeline。你保留完全的偏离权。按实际情况推理决策。")

  return lines.join("\n")
}

function statusLabel(status: GoalStepStatus["status"]): string {
  switch (status) {
    case "pending": return "[PENDING]"
    case "running": return "[RUNNING]"
    case "completed": return "[DONE]"
    case "skipped": return "[SKIPPED]"
    case "failed": return "[FAILED]"
  }
}
