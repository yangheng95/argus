/**
 * OrchestratorConfig — 编排流水线的统一配置中心
 *
 * 所有 agent（spec / planner / evaluator / delivery）和编排策略的默认值
 * 集中定义在此，并从 opencorvus.jsonc 的 `orchestrator` 字段加载用户自定义值。
 *
 * 优先级：环境变量 > opencorvus.jsonc > 此处硬编码默认值
 *
 * 使用方式：
 *   import { OrchestratorConfig } from "@/orchestrator/config"
 *   const cfg = await OrchestratorConfig.get()
 *   cfg.spec.max_steps   // 30 (或用户自定义值)
 */
import { Config } from "@/config/config"

// ═══════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════

export interface SpecConfig {
  max_steps: number
  timeout_ms: number
  quality_threshold: number
  max_attempts: number
  skills: string[]
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
}

export interface DeliveryConfig {
  max_steps: number
  timeout_ms: number
  max_retries: number
  skills: string[]
}

export interface GoalAgentConfig {
  max_steps: number
  timeout_ms: number
  quality_threshold: number
  max_attempts: number
  skills: string[]
}

export interface OrchestratorConfigType {
  spec: SpecConfig
  goal: GoalAgentConfig
  planner: PlannerConfig
  evaluator: EvaluatorConfig
  delivery: DeliveryConfig
  max_runs: number
  max_replans: number
  same_plan_retry_limit: number
  stage_max_retries: number
  max_executor_groups: number
}

// ═══════════════════════════════════════════════════════════════════
// 默认值定义 — 所有硬编码常量的唯一来源
// ═══════════════════════════════════════════════════════════════════

const DEFAULTS: OrchestratorConfigType = {
  spec: {
    max_steps: 30,
    timeout_ms: 300_000,
    quality_threshold: 0.6,
    max_attempts: 3,
    skills: [],
  },
  goal: {
    max_steps: 30,
    timeout_ms: 300_000,
    quality_threshold: 0.5,
    max_attempts: 3,
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
  max_replans: 3,
  same_plan_retry_limit: 2,
  stage_max_retries: 2,
  max_executor_groups: 1,
}

// ═══════════════════════════════════════════════════════════════════
// 环境变量覆盖（最高优先级）
// ═══════════════════════════════════════════════════════════════════

function envInt(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : undefined
}

// ═══════════════════════════════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════════════════════════════

export namespace OrchestratorConfig {
  /** 所有默认值，用于展示 / 对比 / 文档 */
  export const defaults: Readonly<OrchestratorConfigType> = DEFAULTS

  /**
   * 加载完整配置：默认值 ← opencorvus.jsonc ← 环境变量
   *
   * 每次调用都会重新读取 Config（Config 内部有缓存），
   * 因此运行时修改 opencorvus.jsonc 后下一次调用即生效。
   */
  export async function get(): Promise<OrchestratorConfigType> {
    const cfg = await Config.get().catch(() => ({} as Config.Info))
    const user = cfg.orchestrator
    return merge(user)
  }

  /**
   * 同步获取默认值 + 环境变量覆盖（不读取配置文件）
   * 用于模块初始化阶段无法 await 的场景
   */
  export function getDefaults(): OrchestratorConfigType {
    const d = { ...DEFAULTS }
    d.max_runs = envInt("OPENCORVUS_MAX_RUNS") ?? d.max_runs
    d.max_replans = envInt("OPENCORVUS_MAX_REPLANS") ?? d.max_replans
    d.same_plan_retry_limit = envInt("OPENCORVUS_SAME_PLAN_RETRY_LIMIT") ?? d.same_plan_retry_limit
    d.max_executor_groups = envInt("OPENCORVUS_MAX_EXECUTOR_GROUPS") ?? d.max_executor_groups
    return d
  }
}

// ═══════════════════════════════════════════════════════════════════
// 内部合并逻辑
// ═══════════════════════════════════════════════════════════════════

function merge(user?: Config.Info["orchestrator"]): OrchestratorConfigType {
  return {
    spec: {
      max_steps: user?.spec?.max_steps ?? DEFAULTS.spec.max_steps,
      timeout_ms: user?.spec?.timeout_ms ?? DEFAULTS.spec.timeout_ms,
      quality_threshold: user?.spec?.quality_threshold ?? DEFAULTS.spec.quality_threshold,
      max_attempts: user?.spec?.max_attempts ?? DEFAULTS.spec.max_attempts,
      skills: (user?.spec as any)?.skills ?? DEFAULTS.spec.skills,
    },
    goal: {
      max_steps: (user as any)?.goal?.max_steps ?? DEFAULTS.goal.max_steps,
      timeout_ms: (user as any)?.goal?.timeout_ms ?? DEFAULTS.goal.timeout_ms,
      quality_threshold: (user as any)?.goal?.quality_threshold ?? DEFAULTS.goal.quality_threshold,
      max_attempts: (user as any)?.goal?.max_attempts ?? DEFAULTS.goal.max_attempts,
      skills: (user as any)?.goal?.skills ?? DEFAULTS.goal.skills,
    },
    planner: {
      max_steps: user?.planner?.max_steps ?? DEFAULTS.planner.max_steps,
      timeout_ms: user?.planner?.timeout_ms ?? DEFAULTS.planner.timeout_ms,
      quality_threshold: user?.planner?.quality_threshold ?? DEFAULTS.planner.quality_threshold,
      max_attempts: user?.planner?.max_attempts ?? DEFAULTS.planner.max_attempts,
      skills: (user?.planner as any)?.skills ?? DEFAULTS.planner.skills,
    },
    evaluator: {
      max_steps: user?.evaluator?.max_steps ?? DEFAULTS.evaluator.max_steps,
      timeout_ms: user?.evaluator?.timeout_ms ?? DEFAULTS.evaluator.timeout_ms,
      skills: (user?.evaluator as any)?.skills ?? DEFAULTS.evaluator.skills,
      model: (user?.evaluator as any)?.model ?? undefined,
    },
    delivery: {
      max_steps: user?.delivery?.max_steps ?? DEFAULTS.delivery.max_steps,
      timeout_ms: envInt("OPENCORVUS_DELIVERY_AGENT_TIMEOUT_MS") ?? user?.delivery?.timeout_ms ?? DEFAULTS.delivery.timeout_ms,
      max_retries: user?.delivery?.max_retries ?? DEFAULTS.delivery.max_retries,
      skills: (user?.delivery as any)?.skills ?? DEFAULTS.delivery.skills,
    },
    max_runs: envInt("OPENCORVUS_MAX_RUNS") ?? user?.max_runs ?? DEFAULTS.max_runs,
    max_replans: envInt("OPENCORVUS_MAX_REPLANS") ?? user?.max_replans ?? DEFAULTS.max_replans,
    same_plan_retry_limit: envInt("OPENCORVUS_SAME_PLAN_RETRY_LIMIT") ?? user?.same_plan_retry_limit ?? DEFAULTS.same_plan_retry_limit,
    stage_max_retries: user?.stage_max_retries ?? DEFAULTS.stage_max_retries,
    max_executor_groups: envInt("OPENCORVUS_MAX_EXECUTOR_GROUPS") ?? (user as any)?.max_executor_groups ?? DEFAULTS.max_executor_groups,
  }
}
