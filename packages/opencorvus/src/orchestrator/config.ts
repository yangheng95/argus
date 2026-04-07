/**
 * OrchestratorConfig — 编排 agent 的统一配置中心
 *
 * 所有 agent（decompose / planner / evaluator / delivery）和编排策略的默认值
 * 集中定义在此，并从 opencorvus.jsonc 的 `assistant` 字段加载用户自定义值。
 *
 * 优先级：环境变量 > opencorvus.jsonc > 此处硬编码默认值
 *
 * 使用方式：
 *   import { OrchestratorConfig } from "@/orchestrator/config"
 *   const cfg = await OrchestratorConfig.get()
 *   cfg.decompose.max_steps   // 30 (或用户自定义值)
 */
import { Config } from "@/config/config"
import type { MiniWorkflow } from "./workflow"

// ═══════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════

export interface DecomposeConfig {
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

export interface OrchestratorConfigType {
  decompose: DecomposeConfig
  architect: ArchitectConfig
  planner: PlannerConfig
  evaluator: EvaluatorConfig
  delivery: DeliveryConfig
  max_runs: number
  max_fix_runs: number
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
  decompose: {
    max_steps: 30,
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
    max_steps: 40,
    timeout_ms: 600_000,
    max_retries: 2,
    skills: [],
  },
  max_runs: 10,
  max_fix_runs: 5,
  max_executor_groups: 2,
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
    const cfg = await Config.get().catch(() => ({} as Config.Info))
    const user = cfg.assistant
    return merge(user)
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
    decompose: {
      max_steps: user?.decompose?.max_steps ?? DEFAULTS.decompose.max_steps,
      timeout_ms: user?.decompose?.timeout_ms ?? DEFAULTS.decompose.timeout_ms,
      quality_threshold: user?.decompose?.quality_threshold ?? DEFAULTS.decompose.quality_threshold,
      max_attempts: user?.decompose?.max_attempts ?? DEFAULTS.decompose.max_attempts,
      skills: user?.decompose?.skills ?? DEFAULTS.decompose.skills,
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
    max_runs: user?.max_runs ?? DEFAULTS.max_runs,
    max_fix_runs: user?.max_fix_runs ?? DEFAULTS.max_fix_runs,
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
