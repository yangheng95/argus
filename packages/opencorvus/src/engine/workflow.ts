/**
 * MiniWorkflow — 两个声明式工作流模板
 *
 * 系统只内置两条路径：
 *   1. **direct**   — build → deliver（对抗式迭代）
 *      用于显式 kind=build 的单文件改动 / bugfix / 配置调整 / 短篇调试。无需 requirements / architect / goals。
 *   2. **pipeline** — (design_analysis) → requirements → architect → per-goal[build] → deliver
 *      用于多文件功能、UI 复刻、跨模块重构、需要验收标准的任务。
 *
 * 两条路径都以 build 做实现、以 deliver 做对抗式验收，rejection 会循环回到 build 进行返工。
 *
 * MiniWorkflow 不是状态机，不是固定 pipeline。Orchestrator 仍可基于 agent 推理偏离推荐
 * 路径，每个步骤映射到一个已存在的 Orchestrator 工具，工作流只在 system prompt 中以
 * "推荐路径 + 当前进度" 的形式注入。
 */
import { createDecisionLog } from "@/decision-log"
import { EngineConfig } from "./config"
import { goalStatusByID } from "./describe"
import {
  findActiveSpecForTask,
  findLatestIntegrityAttemptArtifact,
  integrityAttemptVerdict,
  findLatestDeliveryVerdictArtifact,
  findRuns,
  findTask,
  listGoals,
  listGoalRunsForTask,
} from "./store"

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
  /** Optional sub-phases within this step — only populated for goal-scope
   *  steps whose single-tool-call invocation internally spawns multiple
   *  sub-agents (e.g. pipeline.build dispatches build worker →
   *  evaluator as plan/build/evaluate phases). Task-scope steps map 1:1
   *  to an orchestrator tool call and have no phases. When present, the
   *  overlay renders phase rows inside the step card and claims child
   *  sessions by phase (not by step). */
  phases?: MiniWorkflowPhase[]
}

/** Sub-phase inside a goal-scope step — reflects the internal structure
 *  of a single `dispatch_goal` dispatch. Phases are projected from
 *  `goal_run.status` (planning / running / evaluating / ...), not driven
 *  by independent tool calls. Each phase maps to the SessionKind the
 *  overlay should claim under this phase. */
export interface MiniWorkflowPhase {
  /** Phase unique ID (within its step). */
  id: string
  /** UI label for the phase row. */
  label: string
  /** SessionKind whose sessions claim under this phase. One phase = one
   *  session kind; multiple phases can't share a kind. */
  sessionKind: string
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
  /** Per-step, per-phase status — only populated for steps that declare
   *  `phases` in their workflow definition. Derived freshly from
   *  `goal_run.status` each projection (see `projectGoalSteps`); never
   *  persisted. Empty for steps without phases. */
  stepPhases?: Record<string, Record<string, GoalStepStatus>>
}

/** 任务级工作流追踪状态（rule 23: 不持有 FSM cell — 步骤状态全部从
 *  artifact/row 现算 via `projectTaskSteps` / `projectGoalSteps`）。
 *
 *  历史上这里还有 `currentStepID` 和 `taskSteps[]` 两个字段，被 trackStep*
 *  在每次 tool 执行时翻字段值并把指针往前挪 —— 经典 FSM。后来步骤投影
 *  方式补齐了（projectTaskSteps 从 decision_log / spec / goals / runs /
 *  delivery 现算），那两个字段就是纯重复来源。删掉。 */
export interface WorkflowState {
  /** 当前使用的 workflow ID */
  workflowID: string
  /** per-goal 派生步骤状态。在 prompt 渲染时通常会被 `projectGoalSteps` 覆盖
   *  （从 goal_run 现算），保留字段是为了向后兼容传入未带 taskID 的渲染调用。 */
  goalSteps: Record<string, GoalWorkflowState>
}

// ═══════════════════════════════════════════════════════════════════
// 内置 Workflow 定义 — 只有两个
// ═══════════════════════════════════════════════════════════════════

/** direct — 即时调用 build，然后 deliver 对抗式验收。
 *
 *  适合：显式 kind=build 的单文件 / 局部 bugfix / 配置调整 / 短调试。无需 goal 分解。
 *  流程：build 实现 → deliver 验证；deliver rejection 触发 orchestrator 重新 call
 *  build 修复（最多 max_delivery_iterations 轮）；delivery 只审查和出 verdict。
 */
const DIRECT: MiniWorkflow = {
  id: "direct",
  name: "Direct",
  description: "analyze_intent → build → deliver 对抗式迭代。用于显式 kind=build 的单文件 / bugfix / 配置 / 短调试 — 无需 goal 分解。",
  steps: [
    {
      id: "analyze_intent",
      tool: "analyze_intent",
      label: "Intent",
      hint: "解读用户真实意图：意图分类、复杂度、缺失槽位、阻断澄清。按需调用 —— request 模糊或 scope 不清时跑；明确的 single-edit 可跳过。返回 blocker clarifications 时先调 question。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "build",
      tool: "build",
      label: "Build",
      hint: "调用 build agent 实现请求（read/write/edit/bash）。无 goalID 只用于显式 kind=build 或 delivery 拒绝后的整体 rework；Pipeline shape (有 goalID) 在 architect 之后用。完成后必须 call deliver。",
      scope: "task",
      skippable: false,
      after: ["analyze_intent"],
    },
    {
      id: "deliver",
      tool: "deliver",
      label: "Deliver",
      hint: "delivery agent 端到端验收 + 发布判定。Reject 会触发 orchestrator 再次 call build 修复，最多 max_delivery_iterations 轮。",
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
 *  流程：(design_analysis 可选) → requirements → architect → per-goal[build + architecture_review] → deliver；
 *  rejection 触发返工。
 */
const PIPELINE: MiniWorkflow = {
  id: "pipeline",
  name: "Pipeline",
  description: "analyze_intent → (design_analysis) → requirements → architect → per-goal[build + architecture_review] → deliver。多文件功能 / UI 复刻 / 跨模块重构。",
  steps: [
    {
      id: "analyze_intent",
      tool: "analyze_intent",
      label: "Intent",
      hint: "解读用户真实意图：意图分类、复杂度、缺失槽位、阻断澄清。按需调用 —— request 模糊或 scope 不清时跑。返回 blocker clarifications 时先调 question。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "design_analysis",
      tool: "design_analysis",
      label: "Design",
      hint: "分析视觉参考（图片/URL），提取布局、样式、组件清单。仅前端/UI 任务且有视觉参考时按需触发。",
      scope: "task",
      skippable: true,
      after: ["analyze_intent"],
    },
    {
      id: "requirements",
      tool: "requirements",
      label: "Requirements",
      hint: "分析输入并分解为 REQ-N + 基础决策。多文件 / 需要显式验收标准时按需调用；trivial direct edit 可跳过。",
      scope: "task",
      skippable: true,
      after: ["design_analysis"],
    },
    {
      id: "architect",
      tool: "architect",
      label: "Architect",
      hint: "权威分解者：读 REQ-N + 决策，产出 goals / 度量 / 挑战种子 / 契约。多 goal / 跨模块时按需调用；trivial 单文件改动可跳过。delivery 拒绝后可 re-run 精修 goal 集合。",
      scope: "task",
      skippable: true,
      after: ["requirements"],
    },
    {
      // Per-goal 实现：每个 goal 派发到 build agent（在 worktree 中）。
      // Orchestrator calls the unified `build` tool with goalID; the build
      // prompt carries a budgeted architecture-consensus view and the build
      // result records architecture_review feedback.
      id: "build",
      tool: "build",
      label: "Executor",
      hint: "执行器在隔离 worktree 中完成一个 goal。每个 build 收到架构共识输入，结束后自动记录 architecture_review 反馈。",
      scope: "goal",
      skippable: false,
      after: ["architect"],
      phases: [
        { id: "build", label: "Build", sessionKind: "build" },
      ],
    },
    {
      id: "integrity",
      tool: "integrity",
      label: "Review",
      hint: "架构复核记录：goal build 完成后自动写入 architecture_review 反馈。该阶段是反馈记录，不是 build 前置门槛，也不自动改写 goal 图。",
      scope: "task",
      skippable: true,
      after: ["build"],
    },
    {
      id: "deliver",
      tool: "deliver",
      label: "Deliver",
      hint: "聚合所有 goal 交付物，delivery agent 端到端验收 + 发布判定。Reject 触发 orchestrator 再 dispatch 受影响的 goal 进行返工。",
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

/** 根据 workflow 定义创建初始 WorkflowState — 任务级步骤状态不再保存在
 *  cell 里，所有现算（rule 23）。 */
export function createWorkflowState(workflow: MiniWorkflow): WorkflowState {
  return {
    workflowID: workflow.id,
    goalSteps: {},
  }
}

/** 根据 tool 名查找 workflow 中对应的 step */
export function findStepByTool(workflow: MiniWorkflow, toolName: string): MiniWorkflowStep | undefined {
  return workflow.steps.find(s => s.tool === toolName)
}

/**
 * Project task-scope step status from persistent side-effects — no FSM cell.
 *
 * Maps each task-scope step's `tool` to whichever DB artifact that tool
 * produces. Presence of the artifact = the step has already been exercised
 * and is reported as `completed`; absence = `pending`. The orchestrator
 * emits `EngineEvent.WorkflowStepUpdated` for transient `running` state,
 * which the overlay consumes live. On reload the board returns `pending`
 * for a step that is currently in-flight — that's a one-frame UI blink,
 * not a correctness regression: the next event rehydrates `running`.
 */
export function projectTaskSteps(
  taskID: string,
  workflow: MiniWorkflow,
): Record<string, GoalStepStatus> {
  const task = findTask(taskID)
  if (!task) return {}
  const out: Record<string, GoalStepStatus> = {}
  for (const step of workflow.steps) {
    if (step.scope !== "task") continue
    out[step.id] = { status: taskStepStatusByTool(taskID, task, step.tool) }
  }
  return out
}

function taskStepStatusByTool(
  taskID: string,
  task: { design_specs?: unknown | null },
  tool: string,
): GoalStepStatus["status"] {
  switch (tool) {
    case "analyze_intent":
      return createDecisionLog(taskID).read().some((e) => e.phase === "intent_analysis")
        ? "completed"
        : "pending"
    case "design_analysis": {
      const specs = task.design_specs
      return Array.isArray(specs) && specs.length > 0 ? "completed" : "pending"
    }
    case "requirements":
      return findActiveSpecForTask(taskID) ? "completed" : "pending"
    case "architect":
      return listGoals(taskID).length > 0 ? "completed" : "pending"
    case "integrity": {
      const activeSpec = findActiveSpecForTask(taskID)
      if (!activeSpec) return "pending"
      const latest = findLatestIntegrityAttemptArtifact({
        taskID,
        specSnapshotID: activeSpec.id,
      })
      const verdict = integrityAttemptVerdict(latest)
      if (verdict === "needs_correction") return "failed"
      const payload = latest?.payload as Record<string, unknown> | null | undefined
      const correctionsCount = typeof payload?.corrections_count === "number" ? payload.corrections_count : 0
      const missingCount = typeof payload?.missing_count === "number" ? payload.missing_count : 0
      if (correctionsCount > 0 || missingCount > 0) return "failed"
      return verdict ? "completed" : "pending"
    }
    case "build":
      // direct workflow: any run (artifact kind="run") means a build occurred
      return findRuns(taskID).length > 0 ? "completed" : "pending"
    case "deliver": {
      // Single source of truth (rule 22): the latest delivery-agent-verdict
      // artifact dictates this step's terminal status. Counting raw delivery
      // artifacts conflates "some delivery row was written" (the deliver
      // tool produces a candidate-delivery artifact BEFORE asking the agent
      // for a verdict) with "deliver passed", which kept the workflow strip
      // showing ✓ on rejected tasks. The transient `running` state still
      // arrives via WorkflowStepUpdated; absence of a verdict means we never
      // reached a terminal state for the current attempt — `pending`.
      const verdict = findLatestDeliveryVerdictArtifact(taskID)
      const v = (verdict?.payload as { verdict?: string } | null | undefined)?.verdict
      if (v === "rejected") return "failed"
      if (v === "accepted") return "completed"
      return "pending"
    }
    default:
      return "pending"
  }
}

/**
 * Project goal-scope step state from engine_goal_run rows for rendering.
 *
 * Per-goal step state was previously a shadow table written imperatively
 * (markGoalWorkflowStep) from goal-pool.ts — that diverged from goal_run in
 * the 006/007 benchmark when updateTask races / exceptions were swallowed.
 *
 * Now the projection is computed fresh each read: there's exactly one
 * goal-scope step (`build`) and its status is whatever the goal's
 * supersede-chain tip goal_run says. One true source, no drift.
 *
 * When a step declares `phases` (e.g. pipeline.build with plan/build/
 * evaluate), we also project per-phase status from the same goal_run.status
 * — goal_run states already encode the phase timeline (planning / running /
 * evaluating). Phase status transitions are deterministic from run status,
 * so there's still one source of truth.
 *
 * Returns the `goalSteps` shape (keyed by goalID) so callers (board.ts,
 * renderWorkflowPrompt) can consume it as if it had been persisted.
 */
export function projectGoalSteps(
  taskID: string,
  workflow: MiniWorkflow,
): Record<string, GoalWorkflowState> {
  const goalScopeSteps = workflow.steps.filter((s) => s.scope === "goal")
  if (goalScopeSteps.length === 0) return {}
  const goals = listGoals(taskID)
  const goalRuns = listGoalRunsForTask(taskID)
  const result: Record<string, GoalWorkflowState> = {}
  const supersededIDs = new Set<string>()
  for (const r of goalRuns) {
    const p = (r as { supersede_of?: string | null }).supersede_of
    if (p) supersededIDs.add(p)
  }
  for (const goal of goals) {
    const runs = goalRuns.filter((r) => r.goal_id === goal.id)
    const tip = runs.find((r) => !supersededIDs.has(r.id)) // runs are desc by time_created
    const stepStatus = mapGoalRunToStepStatus(tip?.status)
    const startedAt = tip?.time_started ?? undefined
    const completedAt = tip?.time_completed ?? undefined
    const steps: Record<string, GoalStepStatus> = {}
    const stepPhases: Record<string, Record<string, GoalStepStatus>> = {}
    for (const step of goalScopeSteps) {
      steps[step.id] = { status: stepStatus, startedAt, completedAt }
      if (step.phases && step.phases.length > 0) {
        stepPhases[step.id] = projectPhases(step.phases, tip?.status, startedAt, completedAt)
      }
    }
    result[goal.id] = {
      goalID: goal.id,
      goalTitle: goal.title,
      goalStatus: goalStatusByID(goal.id),
      steps,
      ...(Object.keys(stepPhases).length > 0 ? { stepPhases } : {}),
    }
  }
  return result
}

/**
 * Map a goal_run.status to per-phase status within a step that declares
 * phases [plan, build, evaluate] (or any 3-phase decomposition).
 *
 * The mapping reflects the in-run timeline:
 *   - queued / accepted          → all phases pending
 *   - planning                   → phase[0] running, rest pending
 *   - running                    → phase[0] completed, phase[1] running, phase[2] pending
 *   - evaluating                 → phases[0..1] completed, phase[2] running
 *   - completed                  → all phases completed
 *   - failed                     → the phase matching the status at failure time
 *                                   is marked failed; earlier phases are completed;
 *                                   later phases stay pending. Without a stored
 *                                   "last active phase" we approximate: failed runs
 *                                   show final phase failed, which is the common case
 *                                   for evaluator-rejection and executor crashes alike.
 *   - aborted                    → all pending
 *   - blocked                    → current phase running (blocked ≈ waiting for input)
 *
 * `startedAt/completedAt` are propagated to every phase to keep the shape
 * simple; the overlay doesn't read them per-phase today.
 */
function projectPhases(
  phases: MiniWorkflowPhase[],
  runStatus: string | undefined,
  startedAt: number | undefined,
  completedAt: number | undefined,
): Record<string, GoalStepStatus> {
  const out: Record<string, GoalStepStatus> = {}
  const setAll = (s: GoalStepStatus["status"]) => {
    for (const p of phases) out[p.id] = { status: s, startedAt, completedAt }
  }
  const setCascade = (runningIndex: number) => {
    // Phases before runningIndex: completed. At runningIndex: running.
    // After: pending. Works for any phase count ≥ runningIndex + 1.
    for (let i = 0; i < phases.length; i++) {
      const status: GoalStepStatus["status"] =
        i < runningIndex ? "completed" : i === runningIndex ? "running" : "pending"
      out[phases[i].id] = { status, startedAt, completedAt }
    }
  }
  switch (runStatus) {
    case undefined:
    case "queued":
    case "accepted":
    case "aborted":
      setAll("pending")
      break
    case "planning":
      setCascade(0)
      break
    case "running":
    case "evaluating":
      // `evaluating` is kept as a legal FSM state for backwards compatibility
      // with existing DB rows (2026-04-20 per-goal evaluator removal); the
      // orchestrator no longer transitions into it, but projecting any
      // historical row alongside `running` (the build phase) stays honest.
      setCascade(1)
      break
    case "blocked":
      // Conservative: mark the last known running phase. Without more
      // information we fall back to "build" (index 1) — that's the phase
      // most commonly stalled on user input / interaction prompts.
      setCascade(Math.min(1, phases.length - 1))
      break
    case "completed":
      setAll("completed")
      break
    case "failed":
      // Mark final phase failed, earlier phases completed. See block comment.
      for (let i = 0; i < phases.length; i++) {
        const status: GoalStepStatus["status"] =
          i < phases.length - 1 ? "completed" : "failed"
        out[phases[i].id] = { status, startedAt, completedAt }
      }
      break
    default:
      setAll("pending")
  }
  return out
}

function mapGoalRunToStepStatus(
  runStatus: string | undefined,
): GoalStepStatus["status"] {
  switch (runStatus) {
    case undefined:
    case "queued":
    case "accepted":
    case "planning":
    case "aborted":
      return "pending"
    case "running":
    case "evaluating":
    case "blocked":
      return "running"
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    default:
      return "pending"
  }
}

/**
 * 渲染 workflow 为 system prompt 文本。
 * 每个步骤标注 [DONE] / [CURRENT] / [PENDING] / [SKIPPED] / [FAILED]。
 *
 * Goal-scope step status is projected from engine_goal_run rows at call time
 * (projectGoalSteps) — NOT read from state.goalSteps, which is no longer
 * a persisted shadow table. Task-scope steps are still read from state.
 */
export function renderWorkflowPrompt(workflow: MiniWorkflow, state: WorkflowState, taskID?: string): string {
  const lines: string[] = []
  lines.push(`## Stage progress (advisory — agents are dispatched on-demand, not in fixed order)`)
  lines.push("")

  // Project step state from artifacts (rule 23 — no FSM cells). Without a
  // taskID we have nothing to project from, so every step shows PENDING:
  // legitimate pre-task state, not data loss.
  const derivedGoalSteps = taskID ? projectGoalSteps(taskID, workflow) : state.goalSteps
  const derivedTaskSteps = taskID ? projectTaskSteps(taskID, workflow) : {}

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i]
    const num = i + 1
    const skip = step.skippable ? " (可跳过)" : ""

    let statusTag = "[PENDING]"
    if (step.scope === "task") {
      const ts = derivedTaskSteps[step.id]
      if (ts) statusTag = statusLabel(ts.status)
    } else {
      // goal-scope: 任一 goal 在跑视为 running；全部 done 算 done
      const goalEntries = Object.values(derivedGoalSteps)
      if (goalEntries.length > 0) {
        const statuses = goalEntries.map(g => g.steps[step.id]?.status ?? "pending")
        if (statuses.some(s => s === "running")) statusTag = "[RUNNING]"
        else if (statuses.every(s => s === "completed" || s === "skipped")) statusTag = "[DONE]"
        else if (statuses.some(s => s === "failed")) statusTag = "[FAILED]"
        else if (statuses.some(s => s === "completed")) statusTag = "[PARTIAL]"
      }
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
    "NOTE: 上面是按需调用的可见进度，不是必须按序触发的状态机。每个 stage agent 是否调用由你 " +
    "（编排器）按 request 形态决定 —— 跳过等同于显式选择，理由要在 reasoning 里讲清楚。`deliver` " +
    "始终是唯一的接受闸；deliver rejection 必须循环回 build 修复，直到接受或耗尽 " +
    "max_delivery_iterations。",
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
