/**
 * OrchestratorConfig — 编排 agent 的统一配置中心
 *
 * 所有 agent（requirements / planner / evaluator / delivery）和编排策略的默认值
 * 集中定义在此，并从 opencorvus.jsonc 的 `assistant` 字段加载用户自定义值。
 *
 * 优先级：环境变量 > opencorvus.jsonc > 此处硬编码默认值
 *
 * 使用方式：
 *   import { OrchestratorConfig } from "@/orchestrator/config"
 *   const cfg = await OrchestratorConfig.get()
 *   cfg.requirements.max_steps   // 100 (或用户自定义值)
 */
import { Config } from "@/config/config"
import type { MiniWorkflow } from "./workflow"

// ═══════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════

export interface RequirementsConfig {
  max_steps: number
  timeout_ms: number
  quality_threshold: number
  max_attempts: number
  skills: string[]
}

export interface ArchitectConfig {
  max_steps: number
  timeout_ms: number
  skills: string[]
  model?: string
}

export interface PlannerConfig {
  max_steps: number
  timeout_ms: number
  quality_threshold: number
  max_attempts: number
  skills: string[]
}

export interface EvaluatorConfig {
  max_steps: number
  timeout_ms: number
  skills: string[]
  model?: string
  /** Evaluation tier: "core" (build/test/lint only), "standard" (+ judge/spec_check/code_review), "full" (all checks). Default: "standard". */
  tier?: "core" | "standard" | "full"
}

export interface DeliveryConfig {
  max_steps: number
  timeout_ms: number
  max_retries: number
  skills: string[]
}

export interface DesignAnalystConfig {
  max_steps: number
  timeout_ms: number
  skills: string[]
  model?: string
}

export interface OrchestratorConfigType {
  requirements: RequirementsConfig
  architect: ArchitectConfig
  planner: PlannerConfig
  evaluator: EvaluatorConfig
  delivery: DeliveryConfig
  design_analyst: DesignAnalystConfig
  max_runs: number
  max_fix_runs: number
  /** Max retries per individual goal. Goal permanently fails after this many retries. */
  max_goal_retries: number
  max_executor_groups: number
  /** Default workflow ID for new tasks. Default: "standard". */
  default_workflow: string
  /** User-defined workflow definitions. Override built-ins by matching ID. */
  workflows: MiniWorkflow[]
}

// ═══════════════════════════════════════════════════════════════════
// 默认值定义 — 所有硬编码常量的唯一来源
// ═══════════════════════════════════════════════════════════════════

const DEFAULTS: OrchestratorConfigType = {
  requirements: {
    max_steps: 100,
    timeout_ms: 300_000,
    quality_threshold: 0.5,
    max_attempts: 3,
    skills: [],
  },
  architect: {
    max_steps: 20,
    timeout_ms: 180_000,
    skills: [],
  },
  planner: {
    max_steps: 30,
    timeout_ms: 300_000,
    quality_threshold: 0.5,
    max_attempts: 3,
    skills: [],
  },
  evaluator: {
    max_steps: 25,
    timeout_ms: 240_000,
    skills: [],
  },
  delivery: {
    // Vision-driven fig2code delivery loops can spend many steps comparing
    // the rendered output against the reference image and editing CSS/layout
    // before producing the final verdict. 40 was hit with the vision channel
    // enabled; raise to 80 to leave room for both rework and verdict emission.
    max_steps: 80,
    timeout_ms: 600_000,
    max_retries: 2,
    skills: [],
  },
  design_analyst: {
    max_steps: 50,
    timeout_ms: 300_000,
    skills: [],
  },
  max_runs: 10,
  max_fix_runs: 20,
  max_goal_retries: 3,
  max_executor_groups: 5,
  default_workflow: "standard",
  workflows: [],
}

// ═══════════════════════════════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════════════════════════════

export namespace OrchestratorConfig {
  /** 所有默认值，用于展示 / 对比 / 文档 */
  export const defaults: Readonly<OrchestratorConfigType> = DEFAULTS

  /**
   * 加载完整配置：默认值 ← opencorvus.jsonc
   *
   * 每次调用都会重新读取 Config（Config 内部有缓存），
   * 因此运行时修改 opencorvus.jsonc 后下一次调用即生效。
   */
  export async function get(): Promise<OrchestratorConfigType> {
    const cfg = await Config.get()
    return merge(cfg.assistant)
  }

  /** 同步获取硬编码默认值（不读取配置文件），用于模块初始化阶段无法 await 的场景 */
  export function getDefaults(): OrchestratorConfigType {
    return { ...DEFAULTS }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 内部合并逻辑
// ═══════════════════════════════════════════════════════════════════

function merge(user?: Config.Info["assistant"]): OrchestratorConfigType {
  return {
    requirements: {
      max_steps: user?.requirements?.max_steps ?? DEFAULTS.requirements.max_steps,
      timeout_ms: user?.requirements?.timeout_ms ?? DEFAULTS.requirements.timeout_ms,
      quality_threshold: user?.requirements?.quality_threshold ?? DEFAULTS.requirements.quality_threshold,
      max_attempts: user?.requirements?.max_attempts ?? DEFAULTS.requirements.max_attempts,
      skills: user?.requirements?.skills ?? DEFAULTS.requirements.skills,
    },
    architect: {
      max_steps: user?.architect?.max_steps ?? DEFAULTS.architect.max_steps,
      timeout_ms: user?.architect?.timeout_ms ?? DEFAULTS.architect.timeout_ms,
      skills: user?.architect?.skills ?? DEFAULTS.architect.skills,
      model: user?.architect?.model ?? undefined,
    },
    planner: {
      max_steps: user?.planner?.max_steps ?? DEFAULTS.planner.max_steps,
      timeout_ms: user?.planner?.timeout_ms ?? DEFAULTS.planner.timeout_ms,
      quality_threshold: user?.planner?.quality_threshold ?? DEFAULTS.planner.quality_threshold,
      max_attempts: user?.planner?.max_attempts ?? DEFAULTS.planner.max_attempts,
      skills: user?.planner?.skills ?? DEFAULTS.planner.skills,
    },
    evaluator: {
      max_steps: user?.evaluator?.max_steps ?? DEFAULTS.evaluator.max_steps,
      timeout_ms: user?.evaluator?.timeout_ms ?? DEFAULTS.evaluator.timeout_ms,
      skills: user?.evaluator?.skills ?? DEFAULTS.evaluator.skills,
      model: user?.evaluator?.model ?? undefined,
      tier: user?.evaluator?.tier ?? "standard",
    },
    delivery: {
      max_steps: user?.delivery?.max_steps ?? DEFAULTS.delivery.max_steps,
      timeout_ms: user?.delivery?.timeout_ms ?? DEFAULTS.delivery.timeout_ms,
      max_retries: user?.delivery?.max_retries ?? DEFAULTS.delivery.max_retries,
      skills: user?.delivery?.skills ?? DEFAULTS.delivery.skills,
    },
    design_analyst: {
      max_steps: user?.design_analyst?.max_steps ?? DEFAULTS.design_analyst.max_steps,
      timeout_ms: user?.design_analyst?.timeout_ms ?? DEFAULTS.design_analyst.timeout_ms,
      skills: user?.design_analyst?.skills ?? DEFAULTS.design_analyst.skills,
      model: user?.design_analyst?.model ?? undefined,
    },
    max_runs: user?.max_runs ?? DEFAULTS.max_runs,
    max_fix_runs: user?.max_fix_runs ?? DEFAULTS.max_fix_runs,
    max_goal_retries: user?.max_goal_retries ?? DEFAULTS.max_goal_retries,
    max_executor_groups: user?.max_executor_groups ?? DEFAULTS.max_executor_groups,
    default_workflow: user?.default_workflow ?? DEFAULTS.default_workflow,
    workflows: (user?.workflows ?? DEFAULTS.workflows).map(w => ({
      id: w.id,
      name: w.name,
      description: w.description ?? "",
      steps: w.steps.map(s => ({
        id: s.id,
        tool: s.tool,
        label: s.label,
        hint: s.hint ?? "",
        scope: s.scope,
        skippable: s.skippable ?? false,
        after: s.after ?? [],
      })),
      goalLoopStepIDs: w.goalLoopStepIDs ?? [],
    })),
  }
}
