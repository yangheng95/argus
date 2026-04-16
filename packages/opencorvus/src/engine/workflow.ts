/**
 * MiniWorkflow — 两个声明式工作流模板
 *
 * 系统只内置两条路径：
 *   1. **direct**   — build → deliver（对抗式迭代）
 *      用于单文件改动 / bugfix / 配置调整 / 短篇调试。无需 requirements / architect / goals。
 *   2. **pipeline** — (design_analysis) → requirements → architect → per-goal[build] → deliver
 *      用于多文件功能、UI 复刻、跨模块重构、需要验收标准的任务。
 *
 * 两条路径都以 build 做实现、以 deliver 做对抗式验收，rejection 会循环回到 build 进行返工。
 *
 * MiniWorkflow 不是状态机，不是固定 pipeline。Orchestrator 仍可基于 agent 推理偏离推荐
 * 路径，每个步骤映射到一个已存在的 Orchestrator 工具，工作流只在 system prompt 中以
 * "推荐路径 + 当前进度" 的形式注入。
 */
import { EngineConfig } from "./config"

// ═══════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════

/** 工作流中的一个步骤 — 映射到 Orchestrator 的一个工具 */
export interface MiniWorkflowStep {
  /** 步骤唯一 ID */
  id: string
  /** 对应的 Orchestrator 工具名 */
  tool: string
  /** UI 显示名 */
  label: string
  /** 注入 system prompt 的简短指引 */
  hint: string
  /** task = 整个任务执行一次, goal = 每个 goal 执行一次 */
  scope: "task" | "goal"
  /** Orchestrator 能否跳过此步骤 */
  skippable: boolean
  /** 前置步骤 ID（声明式依赖，非强制约束） */
  after: string[]
}

/** 一个完整的可插拔工作流模板 */
export interface MiniWorkflow {
  /** 工作流唯一 ID */
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
// 内置 Workflow 定义 — 只有两个
// ═══════════════════════════════════════════════════════════════════

/** direct — 即时调用 build，然后 deliver 对抗式验收。
 *
 *  适合：单文件 / 局部 bugfix / 配置调整 / 短调试。无需 goal 分解。
 *  流程：build 实现 → deliver 验证；deliver rejection 触发 orchestrator 重新 call
 *  build 修复（最多 max_delivery_iterations 轮）。
 */
const DIRECT: MiniWorkflow = {
  id: "direct",
  name: "Direct",
  description: "即时 build → deliver 对抗式迭代。用于单文件 / bugfix / 配置 / 短调试 — 无需 goal 分解。",
  steps: [
    {
      id: "build",
      tool: "build",
      label: "Build",
      hint: "调用 build agent 直接实现请求（read/write/edit/bash）。完成后必须 call deliver — 不再自动 complete 任务。",
      scope: "task",
      skippable: false,
      after: [],
    },
    {
      id: "deliver",
      tool: "deliver",
      label: "Deliver",
      hint: "delivery agent 端到端验收 + 修复 + 发布。Reject 会触发 orchestrator 再次 call build 修复，最多 max_delivery_iterations 轮。",
      scope: "task",
      skippable: false,
      after: ["build"],
    },
  ],
  goalLoopStepIDs: [],
}

/** pipeline — 完整开发流程。
 *
 *  适合：多文件功能 / UI 复刻 / 跨模块重构 / 需要明确验收标准的任务。
 *  流程：(design_analysis 可选) → requirements → architect → per-goal[build] → deliver；
 *  rejection 触发返工。
 */
const PIPELINE: MiniWorkflow = {
  id: "pipeline",
  name: "Pipeline",
  description: "(design_analysis 可选) → requirements → architect → per-goal[build] → deliver。多文件功能 / UI 复刻 / 跨模块重构。",
  steps: [
    {
      id: "design_analysis",
      tool: "design_analysis",
      label: "Design",
      hint: "分析视觉参考（图片/URL），提取布局、样式、组件清单。仅前端/UI 任务且有视觉参考时触发。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "requirements",
      tool: "requirements",
      label: "Requirements",
      hint: "分析输入并分解为带验收标准的 goals。",
      scope: "task",
      skippable: false,
      after: ["design_analysis"],
    },
    {
      id: "architect",
      tool: "architect",
      label: "Architect",
      hint: "多 goal 时协调跨目标接口契约 + 目录蓝图。单 goal 跳过。",
      scope: "task",
      skippable: true,
      after: ["requirements"],
    },
    {
      // Per-goal 实现：每个 goal 派发到 build agent（在 worktree 中）。
      // 真实派发由 GoalPool 完成，工具入口是 `execute_goal`，但语义上每个
      // goal 就是一次"build"调用，UI label 与 direct 路径保持一致。
      id: "build",
      tool: "execute_goal",
      label: "Build",
      hint: "每个 goal 在隔离 worktree 中由 build agent 实现。GoalPool 自动调度。",
      scope: "goal",
      skippable: false,
      after: ["architect"],
    },
    {
      id: "deliver",
      tool: "deliver",
      label: "Deliver",
      hint: "聚合所有 goal 交付物，delivery agent 端到端验收 + 修复 + 发布。Reject 触发 orchestrator 再 dispatch 受影响的 goal 进行返工。",
      scope: "task",
      skippable: false,
      after: ["build"],
    },
  ],
  goalLoopStepIDs: ["build"],
}

// ═══════════════════════════════════════════════════════════════════
// 内置 Workflow 注册表
// ═══════════════════════════════════════════════════════════════════

const BUILT_IN: Record<string, MiniWorkflow> = {
  "direct": DIRECT,
  "pipeline": PIPELINE,
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
    const cfg = await EngineConfig.get()
    const userDefined = cfg.workflows?.find((w: MiniWorkflow) => w.id === workflowID)
    if (userDefined) return userDefined
    return BUILT_IN[workflowID]
  }

  /** 列出所有可用 workflow（内置 + 用户自定义，按 ID 去重）。 */
  export async function list(): Promise<MiniWorkflow[]> {
    const cfg = await EngineConfig.get()
    const userWorkflows = cfg.workflows ?? []
    const userIDs = new Set(userWorkflows.map((w: MiniWorkflow) => w.id))
    const builtInList = Object.values(BUILT_IN).filter(w => !userIDs.has(w.id))
    return [...builtInList, ...userWorkflows]
  }

  /** 获取默认 workflow ID。pipeline 是默认 — 适用范围更广，
   *  误判为 pipeline 的简单任务最多多走一次 requirements；
   *  误判为 direct 的复杂任务则跳过验收标准，恢复成本高。 */
  export async function defaultID(): Promise<string> {
    const cfg = await EngineConfig.get()
    return cfg.default_workflow ?? "pipeline"
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
 * 直接驱动一个 goal-scope 步骤的状态，不经过 Orchestrator 工具调用。
 *
 * 场景：per-goal build 由 GoalPool 内部调度（worktree + executor），没有对应的
 * Orchestrator 工具调用来触发 trackStepStart/Complete。此 helper 让 goal-pool.ts
 * 可以手动推进步骤状态，同时持久化到 task.metadata._workflow 并 emit 事件，
 * 让 UI 与 orchestrator 的 workflow 追踪保持一致。
 */
export async function markGoalWorkflowStep(
  taskID: string,
  goalID: string,
  goalTitle: string,
  stepID: string,
  status: GoalStepStatus["status"],
): Promise<void> {
  const [{ requireTask }, { updateTask }, { EngineProtocol }, { Event }] = await Promise.all([
    import("./store"),
    import("./state"),
    import("./protocol"),
    import("./model"),
  ])
  const task = requireTask(taskID)
  const raw = (task.metadata as Record<string, unknown> | null | undefined)?._workflow as WorkflowState | undefined
  const ws: WorkflowState = raw ?? {
    workflowID: "pipeline",
    currentStepID: null,
    taskSteps: {},
    goalSteps: {},
  }
  const workflow = WorkflowRegistry.resolveSync(ws.workflowID)
  if (!workflow) {
    throw new Error(`workflow "${ws.workflowID}" not found`)
  }
  const step = workflow.steps.find(s => s.id === stepID && s.scope === "goal")
  if (!step) {
    throw new Error(`goal-scope step "${stepID}" not found in workflow "${ws.workflowID}"`)
  }

  if (!ws.goalSteps[goalID]) {
    ws.goalSteps[goalID] = {
      goalID,
      goalTitle,
      goalStatus: "pending",
      steps: createGoalStepStates(workflow),
    }
  }
  const existing = ws.goalSteps[goalID].steps[stepID] ?? { status: "pending" }
  const now = Date.now()
  ws.goalSteps[goalID].steps[stepID] = {
    ...existing,
    status,
    startedAt: status === "running" ? now : existing.startedAt ?? now,
    completedAt: status === "completed" || status === "failed" || status === "skipped" ? now : existing.completedAt,
  }

  const meta = { ...(task.metadata ?? {}), _workflow: ws }
  await updateTask(task, { metadata: meta }, `Goal step ${status}: ${goalID} ${stepID}`)
  EngineProtocol.emit(Event.WorkflowStepUpdated, {
    taskID, stepID, goalID, status,
    summary: `Goal ${goalID}: ${step.label} ${status}`,
  }, { taskID }).catch(() => undefined)
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
  lines.push(
    "NOTE: 这是推荐路径，不是固定 pipeline。允许的偏离：" +
    "(a) pipeline 失败时优先 modify_goal/retry_failed_goals 重走 pipeline；" +
    "(b) 当 goal 级修复明显不够（跨 goal 整合、全局重构）时，回落 direct build 修复后再 deliver；" +
    "(c) direct build 中途发现需要分解时，调 requirements 切到 pipeline。" +
    "deliver rejection 必须循环回 build 修复，直到接受或耗尽 max_delivery_iterations。",
  )

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
