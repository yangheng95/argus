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
  min_tool_calls: number
  quality_threshold: number
  max_attempts: number
}

export interface PlannerConfig {
  max_steps: number
  timeout_ms: number
  min_tool_calls: number
  quality_threshold: number
  max_attempts: number
}

export interface EvaluatorConfig {
  max_steps: number
  timeout_ms: number
  min_tool_calls: number
}

export interface DeliveryConfig {
  max_steps: number
  timeout_ms: number
  max_retries: number
  min_tool_calls: number
}

export interface OrchestratorConfigType {
  spec: SpecConfig
  planner: PlannerConfig
  evaluator: EvaluatorConfig
  delivery: DeliveryConfig
  max_runs: number
  max_replans: number
  same_plan_retry_limit: number
  stage_max_retries: number
}

// ═══════════════════════════════════════════════════════════════════
// 默认值定义 — 所有硬编码常量的唯一来源
// ═══════════════════════════════════════════════════════════════════

const DEFAULTS: OrchestratorConfigType = {
  spec: {
    max_steps: 30,
    timeout_ms: 300_000,
    min_tool_calls: 3,
    quality_threshold: 0.6,
    max_attempts: 3,
  },
  planner: {
    max_steps: 30,
    timeout_ms: 300_000,
    min_tool_calls: 3,
    quality_threshold: 0.5,
    max_attempts: 3,
  },
  evaluator: {
    max_steps: 25,
    timeout_ms: 240_000,
    min_tool_calls: 3,
  },
  delivery: {
    max_steps: 40,
    timeout_ms: 600_000,
    max_retries: 2,
    min_tool_calls: 3,
  },
  max_runs: 10,
  max_replans: 3,
  same_plan_retry_limit: 2,
  stage_max_retries: 2,
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
   * 同步获取默认值（不读取配置文件）
   * 用于模块初始化阶段无法 await 的场景
   */
  export function getDefaults(): OrchestratorConfigType {
    return { ...DEFAULTS }
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
      min_tool_calls: user?.spec?.min_tool_calls ?? DEFAULTS.spec.min_tool_calls,
      quality_threshold: user?.spec?.quality_threshold ?? DEFAULTS.spec.quality_threshold,
      max_attempts: user?.spec?.max_attempts ?? DEFAULTS.spec.max_attempts,
    },
    planner: {
      max_steps: user?.planner?.max_steps ?? DEFAULTS.planner.max_steps,
      timeout_ms: user?.planner?.timeout_ms ?? DEFAULTS.planner.timeout_ms,
      min_tool_calls: user?.planner?.min_tool_calls ?? DEFAULTS.planner.min_tool_calls,
      quality_threshold: user?.planner?.quality_threshold ?? DEFAULTS.planner.quality_threshold,
      max_attempts: user?.planner?.max_attempts ?? DEFAULTS.planner.max_attempts,
    },
    evaluator: {
      max_steps: user?.evaluator?.max_steps ?? DEFAULTS.evaluator.max_steps,
      timeout_ms: user?.evaluator?.timeout_ms ?? DEFAULTS.evaluator.timeout_ms,
      min_tool_calls: user?.evaluator?.min_tool_calls ?? DEFAULTS.evaluator.min_tool_calls,
    },
    delivery: {
      max_steps: user?.delivery?.max_steps ?? DEFAULTS.delivery.max_steps,
      timeout_ms: envInt("OPENCORVUS_DELIVERY_AGENT_TIMEOUT_MS") ?? user?.delivery?.timeout_ms ?? DEFAULTS.delivery.timeout_ms,
      max_retries: user?.delivery?.max_retries ?? DEFAULTS.delivery.max_retries,
      min_tool_calls: user?.delivery?.min_tool_calls ?? DEFAULTS.delivery.min_tool_calls,
    },
    max_runs: envInt("OPENCORVUS_MAX_RUNS") ?? user?.max_runs ?? DEFAULTS.max_runs,
    max_replans: envInt("OPENCORVUS_MAX_REPLANS") ?? user?.max_replans ?? DEFAULTS.max_replans,
    same_plan_retry_limit: envInt("OPENCORVUS_SAME_PLAN_RETRY_LIMIT") ?? user?.same_plan_retry_limit ?? DEFAULTS.same_plan_retry_limit,
    stage_max_retries: user?.stage_max_retries ?? DEFAULTS.stage_max_retries,
  }
}
