/**
 * MiniWorkflow — 两个声明式工作流模板
 *
 * 系统内置少量声明式路径：
 *   1. **direct**   — build
 *      用于显式 kind=build 的单文件改动 / bugfix / 配置调整 / 短篇调试。无需 requirements / architect / goals。
 *   2. **pipeline** — (frontend_research + deep_research) → analyze_intent → requirements → architect → workload_analysis → per-goal[build] → visual_qa / integrity → fact_check
 *      用于多文件功能、UI 复刻、跨模块重构、需要验收标准的任务。
 *   3. **frontend_innovate** — frontend_research / deep_research → frontend_design → requirements / architect → build → visual_qa / integrity
 *      用于 Frontend Innovate HTML 设计稿作为下游参考真值的网页重设计任务。
 *
 * Pipeline 以 build 做实现、以 visual_qa 做 frontend post-build review evidence，
 * 以 integrity 做 session-bound review report。旧 host acceptance mechanism 已禁用，不再作为推荐 workflow 的验收步骤。
 *
 * MiniWorkflow 不是状态机，不是固定 pipeline。Orchestrator 仍可基于 agent 推理偏离推荐
 * 路径，每个步骤映射到一个已存在的 Orchestrator 工具，工作流只在 system prompt 中以
 * "推荐路径 + 当前进度" 的形式注入。
 */
import { createDecisionLog } from "@/decision-log"
import type { AgentRoleID } from "@/agent/role-contract"
import {
  readVisualFeedbackVerificationArtifactByID,
  type VisualFeedbackVerification,
  VisualFeedbackVerificationSchema,
} from "@/acceptance/visual-feedback-verification"
import { ProtocolEventTable } from "@/protocol/protocol.sql"
import { Database, and, desc, eq } from "@/storage/db"
import { FRONTEND_DESIGN_COMPLETION_KEYS } from "@/frontend-design/handoff"
import { visualQaDecisionRecordEffectiveAcceptance } from "@/visual-qa/acceptance-semantics"
import { deriveVisualQaReferenceParityContext } from "@/visual-qa/reference-parity-context"
import { VisualQaDecisionRecordSchema } from "@/visual-qa/schema"
import { EngineConfig, type EngineConfigType } from "./config"
import { goalStatusByID } from "./describe"
import { goalRunWorkflowProjectionStatus } from "./catalog"
import type { EngineGoalRunStatus } from "./engine.sql"
import { WorkflowSelectionSnapshot } from "./model"
import {
  findActiveSpecForTask,
  findLatestFrontendResearchBriefArtifact,
  findLatestIntegrityAttemptArtifact,
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
  tool: OrchestratorWorkflowToolName
  /** Scheduler-owned agent role that this workflow tool dispatches, when the
   *  tool is implemented by a task-worker agent. */
  agentRole?: AgentRoleID
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
  /** Optional capability name for task-level agent outcomes that complete
   *  this step. Declared on the workflow step so board/status projection does
   *  not hard-code a concrete agent such as Build. */
  outcomeCapability?: string
  /** Optional sub-phases within this step — only populated for goal-scope
   *  steps whose single-tool-call invocation exposes more than one visible
   *  execution phase. Task-scope steps map 1:1 to an orchestrator tool call
   *  and have no phases. When present, the overlay renders phase rows inside
   *  the step card and claims child sessions by phase (not by step). */
  phases?: MiniWorkflowPhase[]
}

export type OrchestratorWorkflowToolName =
  | "requirements"
  | "architect"
  | "frontend_design"
  | "frontend_research"
  | "deep_research"
  | "visual_qa"
  | "workload_analysis"
  | "analyze_intent"
  | "fact_check"
  | "build"
  | "explore"
  | "integrity"

export const ORCHESTRATOR_WORKFLOW_TOOL_NAMES = [
  "requirements",
  "architect",
  "frontend_design",
  "frontend_research",
  "deep_research",
  "visual_qa",
  "workload_analysis",
  "analyze_intent",
  "fact_check",
  "build",
  "explore",
  "integrity",
] as const satisfies readonly OrchestratorWorkflowToolName[]

const ORCHESTRATOR_WORKFLOW_TOOL_NAME_SET = new Set<string>(ORCHESTRATOR_WORKFLOW_TOOL_NAMES)

export interface SchedulerAgentWorkflowBinding {
  workflow_tool_name: OrchestratorWorkflowToolName
  stage: AgentRoleID
  target_kind: AgentRoleID
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

export interface WorkflowTaskOutcomeProjection {
  capabilities?: readonly string[]
  status: string
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
      agentRole: "intent-analysis",
      label: "Intent",
      hint: "解读用户真实意图：意图分类、复杂度、缺失槽位、阻断澄清。按需调用 —— request 模糊或 scope 不清时跑；明确的 single-edit 可跳过。返回 blocker clarifications 时先调 question。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "build",
      tool: "build",
      agentRole: "build",
      label: "Build",
      hint: "调用 build agent 实现请求（read/write/edit/bash）。无 goalID 是受支持的 direct build：推荐用于显式 kind=build、完整性复核后的整体 rework，或编排器明确判断无需 goal 分解的 scoped workflow 任务；Pipeline 推荐链路在 architect 之后用有 goalID 的 per-goal build。",
      scope: "task",
      skippable: false,
      after: ["analyze_intent"],
      outcomeCapability: "implementation",
    },
  ],
  goalLoopStepIDs: [],
}

/** pipeline — 完整开发流程。
 *
 *  适合：多文件功能 / UI 复刻 / 跨模块重构 / 需要明确验收标准的任务。
 *  流程：(frontend_research / deep_research 按证据需要) → analyze_intent → requirements → architect → workload_analysis → per-goal[build] → visual_qa / integrity → fact_check → orchestrator lifecycle decision；
 *  visual_qa 是所有 blocking build terminal 后、最终调度决定前的一次性前端视觉/产品审查证据；integrity 是 session-bound review report：pass / non-pass 都只返回证据，完成与失败由编排器显式决定。
 */
const PIPELINE: MiniWorkflow = {
  id: "pipeline",
  name: "Pipeline",
  description:
    "(frontend_research / deep_research 按证据需要) → analyze_intent → requirements → architect → workload_analysis → per-goal[build] → visual_qa / integrity → fact_check。多文件功能 / UI 复刻 / 跨模块重构。",
  steps: [
    {
      id: "frontend_research",
      tool: "frontend_research",
      agentRole: "frontend-research",
      label: "Frontend Research",
      hint: "网页/URL 参考任务的调查分工阶段。source URL 存在时由 host 先准备 rendered webpage evidence；frontend_research 基于证据、源 URL、可见区域、组件/数据/交互/样式疑点和 fidelity risk，发布 source-backed frontend_research_brief/webpage_contract。requirements、architect、build 消费各自 compact projection 作为 investigation work packets。它用小 update_* result tools 分块登记 brief，不提交巨型 terminal payload；不写 final PRD、不产出 frontend implementation template、不调用 build、不选择下一步路线。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "deep_research",
      tool: "deep_research",
      agentRole: "deep-research",
      label: "Deep Research",
      hint: "多源外部事实、当前文档/API/行业资料和开放问题的只读证据收集阶段。按证据需要调用，输出 source-backed research brief 供 requirements、architect、build、integrity 消费；不选择路线、不交付最终实现。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "analyze_intent",
      tool: "analyze_intent",
      agentRole: "intent-analysis",
      label: "Intent",
      hint: "解读用户真实意图：意图分类、复杂度、缺失槽位、阻断澄清。按需调用 —— request 模糊或 scope 不清时跑。视觉/网页参考任务通常等 host evidence/frontend_research 证据完成后再跑。",
      scope: "task",
      skippable: true,
      after: ["frontend_research", "deep_research"],
    },
    {
      id: "requirements",
      tool: "requirements",
      agentRole: "requirements",
      label: "Requirements",
      hint: "分析输入并分解为 REQ-N + 基础决策。多文件 / 需要显式验收标准时按需调用；trivial direct edit 可跳过。",
      scope: "task",
      skippable: true,
      after: ["frontend_research", "deep_research"],
    },
    {
      id: "architect",
      tool: "architect",
      agentRole: "architect",
      label: "Architect",
      hint: "权威分解者：读 REQ-N + 决策，产出 goals / acceptance_specs / traceability / source-reference coverage / cross-goal contracts。网页复刻必须按 web-clone-source/source IR 派生组件源 -> data/API/state adapters -> interactions -> visual/runtime verification 拆出有序 goal；trivial 单文件改动可跳过。integrity 非 pass 后仅在结构性证据成立时 re-run 精修 goal 集合。",
      scope: "task",
      skippable: true,
      after: ["requirements"],
    },
    {
      id: "workload_analysis",
      tool: "workload_analysis",
      agentRole: "goal-workload-analyst",
      label: "Workload",
      hint: "只读 goal 定型复核：深读 frontend template / contract graph / reference coverage，逐 goal 产 why_not_smaller、underestimation_traps、execution_inventory、verification_inventory 和 decomposition_concern。它不创建/修改 goal，不是 gate；concern 回喂 architect 重定型，brief 供 build 反过早最小化。",
      scope: "task",
      skippable: true,
      after: ["architect"],
    },
    {
      // Per-goal 实现：每个 goal 派发到 build agent（在 worktree 中）。
      // Orchestrator calls `dispatch_agent` with target="build" and goalID; the build
      // prompt carries a budgeted architecture-consensus view. After the
      // build completes, post-build architecture_review runs and its full
      // findings are returned inline in the build tool result — host does
      // not auto-route or auto-supersede; orchestrator LLM reads the
      // markdown and decides explicitly.
      id: "build",
      tool: "build",
      agentRole: "build",
      label: "Executor",
      hint: "执行器在隔离 worktree 中完成一个 goal。每个 build 收到架构共识输入；build 完成后 architecture_review 的完整反馈会原文返回给 orchestrator，由 orchestrator LLM 自行决定后续动作（manage_task modify_goal / dispatch_agent build / dispatch_agent architect / dispatch_agent integrity / manage_task fail_task）。",
      scope: "goal",
      skippable: false,
      after: ["workload_analysis"],
      phases: [{ id: "build", label: "Build", sessionKind: "build" }],
    },
    {
      id: "visual_qa",
      tool: "visual_qa",
      agentRole: "visual-qa",
      label: "Visual QA",
      hint: "所有 blocking implementation work terminal 后、最终调度决定前的一次性 GUI 视觉/功能/产品审查证据。GUI=Graphical User Interface，图形用户界面。它消费 task-scoped upstream evidence 以及可选 prior integrity evidence；优先做截图对比和逐屏截图分析，禁止用一次性整页截图 judge 当结论；先审组件真实性和可见功能，再审布局结构，最后才审样式微调。它是 report-only review，不编辑文件，不是 host gate，不替代 integrity，也不是 integrity 的前置状态机；effective_accepted=false 或 production_blockers>0 时由 orchestrator 基于证据和当前 workflow 声明的 implementation owner 选择 repair lane / question / manage_task propose_task / manage_task fail_task。",
      scope: "task",
      skippable: true,
      after: ["build"],
    },
    {
      id: "integrity",
      tool: "integrity",
      agentRole: "integrity",
      label: "Review",
      hint: "系统完整性 review report：在所有 blocking goal build 完成后按证据需要调用。Integrity 在自己的 session 内审查 requirement mining、语义完整性、contract graph 与 delivered system。pass / non-pass 都只返回可操作报告，orchestrator 显式选择 manage_task complete_task / manage_task modify_goal / dispatch_agent build / dispatch_agent architect / manage_task propose_task / question / manage_task fail_task。",
      scope: "task",
      skippable: false,
      after: ["build"],
    },
    {
      id: "fact_check",
      tool: "fact_check",
      agentRole: "fact-check",
      label: "Fact Check",
      hint: "Integrity pass 后按需验证 worker terminal report 中的 fact_check_items：API、版本、数值、路径和历史决策等事实只读核验。输出 verified/corrected/unresolved findings；不修改代码、不选择路线。",
      scope: "task",
      skippable: true,
      after: ["integrity"],
    },
  ],
  goalLoopStepIDs: ["build"],
}

const FRONTEND_INNOVATE: MiniWorkflow = {
  id: "frontend_innovate",
  name: "Frontend Innovate",
  description:
    "(frontend_research / deep_research) → frontend_design → analyze_intent → requirements → architect → workload_analysis → per-goal[build] → visual_qa / integrity → fact_check。用于竞品证据驱动的网页重设计和 HTML 设计稿真值交付。",
  steps: [
    {
      id: "frontend_research",
      tool: "frontend_research",
      agentRole: "frontend-research",
      label: "Frontend Research",
      hint: "源网页调查阶段。source URL 存在时由 host 准备 rendered webpage evidence；frontend_research 产出 source-backed webpage_contract/Page Skeleton Blueprint，供 frontend_design 识别当前页面信息架构、内容、交互和约束。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "deep_research",
      tool: "deep_research",
      agentRole: "deep-research",
      label: "Deep Research",
      hint: "竞品网页、行业模式、当前文档/API 等多源外部事实的只读证据收集阶段。只使用用户给定或证据发现的 URL/资料；不把未验证竞品猜测交给 frontend_design。",
      scope: "task",
      skippable: true,
      after: [],
    },
    {
      id: "frontend_design",
      tool: "frontend_design",
      agentRole: "frontend-design",
      label: "Design",
      hint: "Frontend Innovate 设计稿阶段：消费 frontend_research/deep_research/user-provided reference evidence，检查当前页和证据化竞品网页截图，比较多个重设计方向，选择一个方向，并交付 screenshot-validated source-editable `visual-html-skeleton` HTML/CSS 设计稿作为 downstream Build / Visual QA / Integrity 的参考真值。网页复刻证据存在时，web-clone-source/implementation-blueprint.md、source-ir/component-tree.json、source-ir/style-profile.json、source-skeleton/critical.css 是实现入口；web-clone-source blueprint/source IR/assets 是 LLM 写 React/Vue 等源码的主入口，frontend-design source skeleton/CSS sidecars 必须先成为实现基底，不能被当成旁路参考后从空白页手搓。竞品证据缺失时报告 blocked/incomplete，不猜 URL。",
      scope: "task",
      skippable: false,
      after: ["frontend_research", "deep_research"],
    },
    {
      id: "analyze_intent",
      tool: "analyze_intent",
      agentRole: "intent-analysis",
      label: "Intent",
      hint: "解读用户真实意图。Frontend Innovate 任务通常等 frontend_design HTML 设计稿真值完成后再校正 scope、缺失槽位和阻断问题。",
      scope: "task",
      skippable: true,
      after: ["frontend_design"],
    },
    {
      id: "requirements",
      tool: "requirements",
      agentRole: "requirements",
      label: "Requirements",
      hint: "基于用户请求、source evidence、竞品证据和 frontend_design HTML 设计稿真值分解 REQ-N。原始 source 页面和竞品页面是证据输入；下游视觉目标是 frontend_design 的 rendered HTML design draft。",
      scope: "task",
      skippable: true,
      after: ["frontend_design", "analyze_intent"],
    },
    {
      id: "architect",
      tool: "architect",
      agentRole: "architect",
      label: "Architect",
      hint: "权威分解者：以 frontend_design public report、visual-html-skeleton、visual_validation_evidence、设计方向和 source/competitor evidence 为输入拆 goals。Build 的视觉目标绑定到 HTML 设计稿真值和其截图证据，不回退到原始网页像素复刻。",
      scope: "task",
      skippable: true,
      after: ["requirements"],
    },
    {
      id: "workload_analysis",
      tool: "workload_analysis",
      agentRole: "goal-workload-analyst",
      label: "Workload",
      hint: "只读 goal 定型复核：检查每个 goal 是否覆盖 HTML 设计稿、组件/数据/交互、验证和竞品/source traceability。它不创建/修改 goal。",
      scope: "task",
      skippable: true,
      after: ["architect"],
    },
    {
      id: "build",
      tool: "build",
      agentRole: "build",
      label: "Executor",
      hint: "执行器实现 Architect goal。Frontend Innovate goal 的视觉目标来自 frontend_design HTML 设计稿和 rendered screenshot evidence；原始 source/竞品 evidence 用于约束内容与设计 rationale，不作为最终像素复刻目标。",
      scope: "goal",
      skippable: false,
      after: ["workload_analysis"],
      phases: [{ id: "build", label: "Build", sessionKind: "build" }],
    },
    {
      id: "visual_qa",
      tool: "visual_qa",
      agentRole: "visual-qa",
      label: "Visual QA",
      hint: "所有 blocking implementation work terminal 后执行的 GUI review。Frontend Innovate 视觉对照源是 frontend_design HTML 设计稿及其 screenshot evidence；检查最终实现是否忠实实现 selected direction、状态、布局、内容和可用性。",
      scope: "task",
      skippable: true,
      after: ["build"],
    },
    {
      id: "integrity",
      tool: "integrity",
      agentRole: "integrity",
      label: "Review",
      hint: "系统完整性 review report：审查用户需求、source/competitor evidence、frontend_design HTML 设计稿真值、goal contract、Build 交付和 Visual QA evidence 是否一致。",
      scope: "task",
      skippable: false,
      after: ["build"],
    },
    {
      id: "fact_check",
      tool: "fact_check",
      agentRole: "fact-check",
      label: "Fact Check",
      hint: "Integrity pass 后按需验证 worker terminal report 中的 fact_check_items。",
      scope: "task",
      skippable: true,
      after: ["integrity"],
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
  frontend_innovate: FRONTEND_INNOVATE,
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
    return listForEngineConfig(await EngineConfig.get())
  }

  export function listForEngineConfig(cfg: Pick<EngineConfigType, "workflows">): MiniWorkflow[] {
    const userWorkflows = cfg.workflows ?? []
    const userIDs = new Set(userWorkflows.map((w: MiniWorkflow) => w.id))
    const builtInList = Object.values(BUILT_IN).filter((w) => !userIDs.has(w.id))
    return [...builtInList, ...userWorkflows]
  }

  export async function schedulerAgentWorkflowBindings(): Promise<SchedulerAgentWorkflowBinding[]> {
    const workflows = await list()
    return mergeSchedulerAgentWorkflowBindings(workflows)
  }

  export function schedulerAgentWorkflowBindingsForEngineConfig(
    cfg: Pick<EngineConfigType, "workflows">,
  ): SchedulerAgentWorkflowBinding[] {
    return mergeSchedulerAgentWorkflowBindings(listForEngineConfig(cfg))
  }

  /** 获取默认 workflow ID。pipeline 是默认 — 适用范围更广，
   *  误判为 pipeline 的简单任务最多多走一次 requirements；
   *  误判为 direct 的复杂任务则跳过验收标准，恢复成本高。 */
  export async function defaultID(): Promise<string> {
    const cfg = await EngineConfig.get()
    return cfg.default_workflow ?? "pipeline"
  }

  /** Scheduler-scope workflow selection for engine task kinds.
   *
   *  Keep task-kind to workflow mapping here so Orchestrator workers and tools
   *  consume a scheduler decision instead of naming or rewriting workflows.
   */
  export async function defaultIDForTaskKind(kind: "workflow" | "build"): Promise<string> {
    if (kind === "build") return "direct"
    return defaultID()
  }

  export function builtInDefaultIDForTaskKind(kind: "workflow" | "build"): string | undefined {
    if (kind === "build") return "direct"
    return undefined
  }

  /** 同步获取内置 workflow（不读取 config） */
  export function resolveSync(workflowID: string): MiniWorkflow | undefined {
    return BUILT_IN[workflowID]
  }

  export function schedulerAgentWorkflowBindingsSync(): SchedulerAgentWorkflowBinding[] {
    return mergeSchedulerAgentWorkflowBindings(Object.values(BUILT_IN))
  }

  export function schedulerAgentWorkflowBindingsForWorkflow(
    workflow: MiniWorkflow | undefined,
  ): SchedulerAgentWorkflowBinding[] {
    return workflow ? mergeSchedulerAgentWorkflowBindings([workflow]) : []
  }

  export function schedulerAgentWorkflowBindingForRoleSync(
    role: AgentRoleID,
  ): SchedulerAgentWorkflowBinding | undefined {
    return schedulerAgentWorkflowBindingsSync().find((binding) => binding.stage === role)
  }

  export function schedulerAgentWorkflowBindingForRoleInWorkflow(
    workflow: MiniWorkflow | undefined,
    role: AgentRoleID,
  ): SchedulerAgentWorkflowBinding | undefined {
    return schedulerAgentWorkflowBindingsForWorkflow(workflow).find((binding) => binding.stage === role)
  }

  export function schedulerAgentWorkflowBindingForToolSync(tool: string): SchedulerAgentWorkflowBinding | undefined {
    return schedulerAgentWorkflowBindingsSync().find((binding) => binding.workflow_tool_name === tool)
  }

  export function schedulerAgentWorkflowBindingForToolInWorkflow(
    workflow: MiniWorkflow | undefined,
    tool: string,
  ): SchedulerAgentWorkflowBinding | undefined {
    return schedulerAgentWorkflowBindingsForWorkflow(workflow).find((binding) => binding.workflow_tool_name === tool)
  }

  export function schedulerWorkflowToolForRoleSync(role: AgentRoleID): OrchestratorWorkflowToolName | undefined {
    return schedulerAgentWorkflowBindingForRoleSync(role)?.workflow_tool_name
  }

  export function schedulerRoleForWorkflowToolSync(tool: OrchestratorWorkflowToolName): AgentRoleID | undefined {
    return schedulerAgentWorkflowBindingForToolSync(tool)?.stage
  }

  export function isSchedulerWorkflowToolName(tool: string): tool is OrchestratorWorkflowToolName {
    return Boolean(schedulerAgentWorkflowBindingForToolSync(tool))
  }

  export function isWorkflowToolName(tool: string): tool is OrchestratorWorkflowToolName {
    return ORCHESTRATOR_WORKFLOW_TOOL_NAME_SET.has(tool)
  }
}

export function latestWorkflowSelectionForTask(
  taskID: string,
): { workflowID: string; workflow?: MiniWorkflow } | undefined {
  const row = Database.use((db) =>
    db
      .select({
        payload: ProtocolEventTable.payload,
      })
      .from(ProtocolEventTable)
      .where(and(eq(ProtocolEventTable.task_id, taskID), eq(ProtocolEventTable.type, "workflow.selected")))
      .orderBy(desc(ProtocolEventTable.emitted_at), desc(ProtocolEventTable.seq))
      .limit(1)
      .get(),
  )
  const payload = row?.payload as { workflowID?: unknown; workflow?: unknown } | null | undefined
  if (!payload) return undefined
  if (typeof payload.workflowID !== "string" || payload.workflowID.trim().length === 0) {
    throw new Error(`workflow.selected payload invalid for task ${taskID}: ${JSON.stringify(payload)}`)
  }
  const workflow = parseWorkflowSelectionSnapshot(payload.workflow, taskID, payload.workflowID)
  return { workflowID: payload.workflowID, ...(workflow ? { workflow } : {}) }
}

export function workflowSelectionSnapshot(workflow: MiniWorkflow): MiniWorkflow {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    steps: workflow.steps.map((step) => ({
      id: step.id,
      tool: step.tool,
      ...(step.agentRole ? { agentRole: step.agentRole } : {}),
      label: step.label,
      hint: step.hint,
      scope: step.scope,
      skippable: step.skippable,
      after: [...step.after],
      ...(step.outcomeCapability ? { outcomeCapability: step.outcomeCapability } : {}),
      ...(step.phases?.length
        ? { phases: step.phases.map((phase) => ({ id: phase.id, label: phase.label, sessionKind: phase.sessionKind })) }
        : {}),
    })),
    goalLoopStepIDs: [...workflow.goalLoopStepIDs],
  }
}

function parseWorkflowSelectionSnapshot(value: unknown, taskID: string, workflowID: string): MiniWorkflow | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = WorkflowSelectionSnapshot.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `workflow.selected snapshot invalid for task ${taskID} workflow ${workflowID}: ${parsed.error.message}`,
    )
  }
  return parsed.data as MiniWorkflow
}

function mergeSchedulerAgentWorkflowBindings(workflows: readonly MiniWorkflow[]): SchedulerAgentWorkflowBinding[] {
  const byRole = new Map<AgentRoleID, SchedulerAgentWorkflowBinding>()
  for (const workflow of workflows) {
    for (const step of workflow.steps) {
      if (!step.agentRole) continue
      byRole.set(step.agentRole, {
        workflow_tool_name: step.tool,
        stage: step.agentRole,
        target_kind: step.agentRole,
      })
    }
  }
  return [...byRole.values()]
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
export function projectTaskSteps(
  taskID: string,
  workflow: MiniWorkflow,
  outcomes: readonly WorkflowTaskOutcomeProjection[] = [],
): Record<string, GoalStepStatus> {
  const task = findTask(taskID)
  if (!task) return {}
  const out: Record<string, GoalStepStatus> = {}
  for (const step of workflow.steps) {
    if (step.scope !== "task") continue
    out[step.id] = { status: taskStepStatusByTool(taskID, task, step, outcomes) }
  }
  return out
}

function taskStepStatusByTool(
  taskID: string,
  task: { design_specs?: unknown | null },
  step: MiniWorkflowStep,
  outcomes: readonly WorkflowTaskOutcomeProjection[],
): GoalStepStatus["status"] {
  const outcomeStatus = step.outcomeCapability
    ? latestTerminalOutcomeStatusByCapability(outcomes, step.outcomeCapability)
    : undefined
  if (outcomeStatus) return outcomeStatus
  const tool = step.tool
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
    default:
      return "pending"
  }
}

function latestTerminalOutcomeStatusByCapability(
  outcomes: readonly WorkflowTaskOutcomeProjection[],
  capability: string,
): GoalStepStatus["status"] | undefined {
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    const outcome = outcomes[index]
    if (!(outcome.capabilities ?? []).includes(capability)) continue
    if (outcome.status === "completed" || outcome.status === "failed" || outcome.status === "aborted") {
      return outcome.status
    }
  }
  return undefined
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

    lines.push(`${num}. [${step.scope}] dispatch_agent target=${step.tool} — ${step.hint}${skip} ${statusTag}`)
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
      "（编排器）按 request 形态决定 —— 跳过等同于显式选择，理由要在 reasoning 里讲清楚。Pipeline 的 review report surface 是 dispatch_agent target=integrity；" +
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
