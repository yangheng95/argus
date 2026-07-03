/**
 * MiniWorkflow — 两个声明式工作流模板
 *
 * 系统只内置两条路径：
 *   1. **direct**   — build
 *      用于显式 kind=build 的单文件改动 / bugfix / 配置调整 / 短篇调试。无需 requirements / architect / goals。
 *   2. **pipeline** — (frontend_design + frontend_research) → analyze_intent → requirements → architect → workload_analysis → per-goal[build] → visual_qa / integrity
 *      用于多文件功能、UI 复刻、跨模块重构、需要验收标准的任务。
 *
 * Pipeline 以 build 做实现、以 visual_qa 做 frontend post-build review evidence，
 * 以 integrity 做 session-bound review report。旧 host acceptance mechanism 已禁用，不再作为推荐 workflow 的验收步骤。
 *
 * MiniWorkflow 不是状态机，不是固定 pipeline。Orchestrator 仍可基于 agent 推理偏离推荐
 * 路径，每个步骤映射到一个已存在的 Orchestrator 工具，工作流只在 system prompt 中以
 * "推荐路径 + 当前进度" 的形式注入。
 */
import { createDecisionLog } from "@/decision-log"
import {
  readVisualFeedbackVerificationArtifactByID,
  type VisualFeedbackVerification,
  VisualFeedbackVerificationSchema,
} from "@/acceptance/visual-feedback-verification"
import { FRONTEND_DESIGN_COMPLETION_KEYS } from "@/frontend-design/handoff"
import { visualQaDecisionRecordEffectiveAcceptance } from "@/visual-qa/acceptance-semantics"
import { deriveVisualQaReferenceParityContext } from "@/visual-qa/reference-parity-context"
import { VisualQaDecisionRecordSchema } from "@/visual-qa/schema"
import { EngineConfig } from "./config"
import { goalStatusByID } from "./describe"
import { goalRunWorkflowProjectionStatus } from "./catalog"
import type { EngineGoalRunStatus } from "./engine.sql"
import {
  findActiveSpecForTask,
  findLatestFrontendResearchBriefArtifact,
  findLatestIntegrityAttemptArtifact,
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
   *  steps whose single-tool-call invocation exposes more than one visible
   *  execution phase. Task-scope steps map 1:1 to an orchestrator tool call
   *  and have no phases. When present, the overlay renders phase rows inside
   *  the step card and claims child sessions by phase (not by step). */
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
  status: "pending" | "running" | "completed" | "skipped" | "failed" | "aborted"
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
 *  acceptance 现算），那两个字段就是纯重复来源。删掉。 */
export interface WorkflowState {
  /** 当前使用的 workflow ID */
  workflowID: string
  /** per-goal 派生步骤状态。带 taskID 的渲染调用使用 `projectGoalSteps`
   *  从 goal_run 现算；无 taskID 的 prompt 预览调用必须显式传入该字段。 */
  goalSteps: Record<string, GoalWorkflowState>
}

// ═══════════════════════════════════════════════════════════════════
// 内置 Workflow 定义 — 只有两个
// ═══════════════════════════════════════════════════════════════════

/** direct — 即时调用 build。
 *
 *  适合：显式 kind=build 的单文件 / 局部 bugfix / 配置调整 / 短调试。无需 goal 分解。
 *  流程：build 实现。需要结构化验收的任务应走 pipeline，这样 integrity
 *  可以读取 requirements / architect / goal build evidence 后做最终 review。
 */
const DIRECT: MiniWorkflow = {
  id: "direct",
  name: "Direct",
  description: "analyze_intent → build。用于显式 kind=build 的单文件 / bugfix / 配置 / 短调试 — 无需 goal 分解。",
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
      hint: "调用 build agent 实现请求（read/write/edit/bash）。无 goalID 是受支持的 direct build：推荐用于显式 kind=build、完整性复核后的整体 rework，或编排器明确判断无需 goal 分解的 scoped workflow 任务；Pipeline 推荐链路在 architect 之后用有 goalID 的 per-goal build。",
      scope: "task",
      skippable: false,
      after: ["analyze_intent"],
    },
  ],
  goalLoopStepIDs: [],
}

/** pipeline — 完整开发流程。
 *
 *  适合：多文件功能 / UI 复刻 / 跨模块重构 / 需要明确验收标准的任务。
 *  流程：(frontend_design / frontend_research 按证据需要) → analyze_intent → requirements → architect → workload_analysis → per-goal[build] → visual_qa / integrity → orchestrator lifecycle decision；
 *  visual_qa 是所有 blocking build terminal 后、最终调度决定前的一次性前端视觉/产品审查证据；integrity 是 session-bound review report：pass / non-pass 都只返回证据，完成与失败由编排器显式决定。
 */
const PIPELINE: MiniWorkflow = {
  id: "pipeline",
  name: "Pipeline",
  description:
    "(frontend_design / frontend_research 按证据需要) → analyze_intent → requirements → architect → workload_analysis → per-goal[build] → visual_qa / integrity。多文件功能 / UI 复刻 / 跨模块重构。",
  steps: [
    {
      id: "frontend_design",
      tool: "frontend_design",
      label: "Design",
      hint: "视觉/网页/图片/Figma 参考任务的前端设计/复刻专职阶段。负责 materialization/source handoff 证据获取与落成，产出前端实现级 frontend template、visual_consistency_contract、evidence_source_manifest；网页复刻还要产出 reference.png + web-clone-source/implementation-blueprint.md + source-ir/component-tree.json + source-ir/content-model.json + source-ir/layout-map.json + source-ir/style-profile.json + source-ir/style-tokens.json + source-ir/interaction-hints.json + source-ir/interaction-state-snapshots.json + source-skeleton/critical.css + visual-surface-candidates.json 作为 build 开发入口（截图是视觉真值，style-profile 是区域级样式复用材料，web-clone-source blueprint/source IR/assets 是 LLM 写 React/Vue 等源码的主入口，frontend-design source skeleton/CSS sidecars 必须先成为实现基底，不能被当成旁路参考后从空白页手搓）。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "frontend_research",
      tool: "frontend_research",
      label: "Frontend Research",
      hint: "网页/URL 参考任务的调查分工阶段。source URL 存在时由 host 先准备 rendered webpage evidence；frontend_research 基于证据、源 URL、可见区域、组件/数据/交互/样式疑点和 fidelity risk，发布 source-backed frontend_research_brief/webpage_contract。frontend_design 通过 Page Skeleton Blueprint 消费它作为页面信息架构，requirements、architect、build 消费各自 compact projection 作为 investigation work packets。它用小 update_* result tools 分块登记 brief，不提交巨型 terminal payload；不写 final PRD、不产出 frontend implementation template、不调用 build、不选择下一步路线。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "analyze_intent",
      tool: "analyze_intent",
      label: "Intent",
      hint: "解读用户真实意图：意图分类、复杂度、缺失槽位、阻断澄清。按需调用 —— request 模糊或 scope 不清时跑。视觉/网页参考任务通常等 frontend_design/frontend_research 证据完成后再跑。",
      scope: "task",
      skippable: true,
      after: ["frontend_design", "frontend_research"],
    },
    {
      id: "requirements",
      tool: "requirements",
      label: "Requirements",
      hint: "分析输入并分解为 REQ-N + 基础决策。多文件 / 需要显式验收标准时按需调用；trivial direct edit 可跳过。",
      scope: "task",
      skippable: true,
      after: ["frontend_design", "frontend_research"],
    },
    {
      id: "architect",
      tool: "architect",
      label: "Architect",
      hint: "权威分解者：读 REQ-N + 决策，产出 goals / acceptance_specs / traceability / source-reference coverage / cross-goal contracts。网页复刻必须按 web-clone-source/source IR 派生组件源 -> data/API/state adapters -> interactions -> visual/runtime verification 拆出有序 goal；trivial 单文件改动可跳过。integrity 非 pass 后仅在结构性证据成立时 re-run 精修 goal 集合。",
      scope: "task",
      skippable: true,
      after: ["requirements"],
    },
    {
      id: "workload_analysis",
      tool: "workload_analysis",
      label: "Workload",
      hint: "只读 goal 定型复核：深读 frontend template / contract graph / reference coverage，逐 goal 产 why_not_smaller、underestimation_traps、execution_inventory、verification_inventory 和 decomposition_concern。它不创建/修改 goal，不是 gate；concern 回喂 architect 重定型，brief 供 build 反过早最小化。",
      scope: "task",
      skippable: true,
      after: ["architect"],
    },
    {
      // Per-goal 实现：每个 goal 派发到 build agent（在 worktree 中）。
      // Orchestrator calls the unified `build` tool with goalID; the build
      // prompt carries a budgeted architecture-consensus view. After the
      // build completes, post-build architecture_review runs and its full
      // findings are returned inline in the build tool result — host does
      // not auto-route or auto-supersede; orchestrator LLM reads the
      // markdown and decides explicitly.
      id: "build",
      tool: "build",
      label: "Executor",
      hint: "执行器在隔离 worktree 中完成一个 goal。每个 build 收到架构共识输入；build 完成后 architecture_review 的完整反馈会原文返回给 orchestrator，由 orchestrator LLM 自行决定后续动作（modify_goal / build / architect / integrity / fail_task）。",
      scope: "goal",
      skippable: false,
      after: ["workload_analysis"],
      phases: [{ id: "build", label: "Build", sessionKind: "build" }],
    },
    {
      id: "visual_qa",
      tool: "visual_qa",
      label: "Visual QA",
      hint: "所有 blocking build terminal 后、最终调度决定前的一次性 GUI 视觉/功能/产品审查与 in-scope repair 证据。GUI=Graphical User Interface，图形用户界面。它消费 frontend_design/build 以及可选 prior integrity evidence；优先做截图对比和逐屏截图分析，禁止用一次性整页截图 judge 当结论；先修组件真实性和可见功能，再修布局结构，最后才做样式微调。它不是 host gate，不替代 integrity，也不是 integrity 的前置状态机；accepted=false 或 production_blockers>0 时由 orchestrator 基于证据选择 build / modify_goal / architect / propose_task / fail_task。",
      scope: "task",
      skippable: true,
      after: ["build"],
    },
    {
      id: "integrity",
      tool: "integrity",
      label: "Review",
      hint: "系统完整性 review report：在所有 blocking goal build 完成后按证据需要调用。Integrity 在自己的 session 内审查 requirement mining、语义完整性、contract graph 与 delivered system。pass / non-pass 都只返回可操作报告，orchestrator 显式选择 complete_task / modify_goal / build / architect / propose_task / question / fail_task。",
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
  direct: DIRECT,
  pipeline: PIPELINE,
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
    const builtInList = Object.values(BUILT_IN).filter((w) => !userIDs.has(w.id))
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
  return workflow.steps.find((s) => s.tool === toolName)
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
export function projectTaskSteps(taskID: string, workflow: MiniWorkflow): Record<string, GoalStepStatus> {
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
    case "analyze_intent": {
      const entries = createDecisionLog(taskID).readByPhase("intent_analysis")
      if (entries.some((entry) => entry.key === "abort_intent_analysis_failed")) return "failed"
      return entries.length > 0 ? "completed" : "pending"
    }
    case "frontend_design": {
      const keys = new Set(
        createDecisionLog(taskID)
          .readByPhase("frontend_design")
          .map((entry) => entry.key),
      )
      return FRONTEND_DESIGN_COMPLETION_KEYS.every((key) => keys.has(key)) ? "completed" : "pending"
    }
    case "frontend_research":
      return findLatestFrontendResearchBriefArtifact(taskID) ? "completed" : "pending"
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
        phase: "post_build",
      })
      return latest ? "completed" : "pending"
    }
    case "visual_qa":
      return visualQaProjectedStatus(taskID)
    case "build":
      // direct workflow: any run (artifact kind="run") means a build occurred
      return findRuns(taskID).length > 0 ? "completed" : "pending"
    default:
      return "pending"
  }
}

function visualQaProjectedStatus(taskID: string): GoalStepStatus["status"] {
  const decisionLog = createDecisionLog(taskID)
  const entries = decisionLog.readByPhase("visual_qa")
  const activeSpec = findActiveSpecForTask(taskID)
  const visualFeedbackVerificationRequired = deriveVisualQaReferenceParityContext({
    taskID,
    specSnapshotID: activeSpec?.id,
    goals: listGoals(taskID),
    frontendDesignEntries: decisionLog.readByPhase("frontend_design"),
  }).required
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.key.startsWith("report_")) {
      const projection = parseVisualQaReportProjection(entry.value)
      if (!projection) return "failed"
      const requiresVisualFeedbackVerification =
        visualFeedbackVerificationRequired || projection.requiresVisualFeedbackVerification
      if (!requiresVisualFeedbackVerification) return projection.effectiveAccepted ? "completed" : "failed"
      const verified = parseVisualFeedbackVerificationProjectionAfterReport({
        taskID,
        entries,
        reportIndex: index,
      })
      if (verified === undefined) return "failed"
      return verified ? "completed" : "failed"
    }
    if (entry.key === "latest_summary") {
      continue
    }
  }
  return "pending"
}

function parseVisualQaReportProjection(
  value: string,
): { effectiveAccepted: boolean; requiresVisualFeedbackVerification: boolean } | undefined {
  try {
    const parsed = VisualQaDecisionRecordSchema.safeParse(JSON.parse(value))
    if (!parsed.success) return undefined
    return {
      effectiveAccepted: visualQaDecisionRecordEffectiveAcceptance(parsed.data).effectiveAccepted,
      requiresVisualFeedbackVerification:
        parsed.data.report.reference_parity.required ||
        parsed.data.report.reference_parity.reference_comparison_evidence_refs.length > 0,
    }
  } catch {
    return undefined
  }
}

function parseVisualFeedbackVerificationProjectionAfterReport(input: {
  taskID: string
  entries: DecisionEntryLike[]
  reportIndex: number
}): boolean | undefined {
  for (let index = input.entries.length - 1; index > input.reportIndex; index -= 1) {
    const entry = input.entries[index]
    if (entry.key.startsWith("report_")) return undefined
    if (!entry.key.startsWith("visual_feedback_verification_")) continue
    const parsed = parseVisualFeedbackVerificationDecision(entry.value)
    if (!parsed) return undefined
    const artifact = readVisualFeedbackVerificationArtifactByID({
      taskID: input.taskID,
      artifactID: parsed.artifactID,
    })
    if (!artifact) return undefined
    if (artifact.id !== parsed.verification.id || artifact.runID !== parsed.verification.runID) return undefined
    return artifact.status === "passed"
  }
  return undefined
}

type DecisionEntryLike = { key: string; value: string }

function parseVisualFeedbackVerificationDecision(
  value: string,
): { artifactID: string; verification: VisualFeedbackVerification } | undefined {
  try {
    const payload = JSON.parse(value) as Record<string, unknown>
    if (!payload || typeof payload !== "object" || typeof payload.artifact_id !== "string") return undefined
    const parsed = VisualFeedbackVerificationSchema.safeParse(payload.visual_feedback_verification)
    if (!parsed.success) return undefined
    return { artifactID: payload.artifact_id, verification: parsed.data }
  } catch {
    return undefined
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
 * When a step declares `phases` (currently pipeline.build declares only the
 * `build` phase), per-phase cards are projected only for a tip with a concrete
 * build session. Sessionless manual completion remains a status fact, not a
 * materialized build-session phase.
 *
 * Returns a goalID-keyed projection for board.ts and renderWorkflowPrompt.
 * The value is computed from engine rows on every read, not persisted state.
 */
export function projectGoalSteps(taskID: string, workflow: MiniWorkflow): Record<string, GoalWorkflowState> {
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
    const effectiveStatus = tip?.status
    const stepStatus = mapGoalRunToStepStatus(tip?.status)
    const hasBuildSession = typeof tip?.session_id === "string" && tip.session_id.length > 0
    const startedAt = hasBuildSession ? (tip?.time_started ?? undefined) : undefined
    const completedAt = hasBuildSession ? (tip?.time_completed ?? undefined) : undefined
    const steps: Record<string, GoalStepStatus> = {}
    const stepPhases: Record<string, Record<string, GoalStepStatus>> = {}
    for (const step of goalScopeSteps) {
      steps[step.id] = { status: stepStatus, startedAt, completedAt }
      if (hasBuildSession && step.phases && step.phases.length > 0) {
        stepPhases[step.id] = projectPhases(step.phases, effectiveStatus, startedAt, completedAt)
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
 * phases. The current pipeline build step declares one phase: `build`.
 *
 * `startedAt/completedAt` are propagated to every declared phase to keep the
 * shape simple; the overlay doesn't read them per-phase today.
 */
function projectPhases(
  phases: MiniWorkflowPhase[],
  runStatus: EngineGoalRunStatus | undefined,
  startedAt: number | undefined,
  completedAt: number | undefined,
): Record<string, GoalStepStatus> {
  const out: Record<string, GoalStepStatus> = {}
  const setAll = (s: GoalStepStatus["status"]) => {
    for (const p of phases) out[p.id] = { status: s, startedAt, completedAt }
  }
  setAll(goalRunWorkflowProjectionStatus(runStatus) ?? "pending")
  return out
}

function mapGoalRunToStepStatus(runStatus: EngineGoalRunStatus | undefined): GoalStepStatus["status"] {
  return goalRunWorkflowProjectionStatus(runStatus) ?? "pending"
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

  // Project step state from artifacts (rule 23 — no FSM cells). Calls without
  // taskID are prompt previews and must supply explicit state.goalSteps.
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
        const statuses = goalEntries.map((g) => g.steps[step.id]?.status ?? "pending")
        if (statuses.some((s) => s === "running")) statusTag = "[RUNNING]"
        else if (statuses.every((s) => s === "completed" || s === "skipped")) statusTag = "[DONE]"
        else if (statuses.some((s) => s === "failed")) statusTag = "[FAILED]"
        else if (statuses.some((s) => s === "completed")) statusTag = "[PARTIAL]"
      }
    }

    lines.push(`${num}. [${step.scope}] ${step.tool} — ${step.hint}${skip} ${statusTag}`)
  }

  if (workflow.goalLoopStepIDs.length > 0) {
    const loopLabels = workflow.goalLoopStepIDs
      .map((id) => workflow.steps.find((s) => s.id === id)?.label ?? id)
      .join(" → ")
    lines.push("")
    lines.push(`Per-goal 步骤 [${loopLabels}] 对每个 goal 重复执行。`)
  }

  lines.push("")
    lines.push(
      "NOTE: 上面是按需调用的可见进度，不是必须按序触发的状态机。每个 stage agent 是否调用由你 " +
      "（编排器）按 request 形态决定 —— 跳过等同于显式选择，理由要在 reasoning 里讲清楚。Pipeline 的 review report surface 是 `integrity`；" +
      "integrity pass / non-pass 都只返回 session-bound review evidence，完成、修复、提问、拆 follow-up 或失败由编排器基于证据显式决定。",
  )

  return lines.join("\n")
}

function statusLabel(status: GoalStepStatus["status"]): string {
  switch (status) {
    case "pending":
      return "[PENDING]"
    case "running":
      return "[RUNNING]"
    case "completed":
      return "[DONE]"
    case "skipped":
      return "[SKIPPED]"
    case "failed":
      return "[FAILED]"
    case "aborted":
      return "[ABORTED]"
  }
}
