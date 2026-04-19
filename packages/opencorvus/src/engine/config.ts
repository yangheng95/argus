/**
 * EngineConfig — 编排 agent 的统一配置中心
 *
 * 所有 agent（requirements / planner / evaluator / delivery）和编排策略的默认值
 * 集中定义在此，并从 opencorvus.jsonc 的 `assistant` 字段加载用户自定义值。
 *
 * 优先级：环境变量 > opencorvus.jsonc > 此处硬编码默认值
 *
 * 使用方式：
 *   import { EngineConfig } from "@/engine/config"
 *   const cfg = await EngineConfig.get()
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
}

export interface PlannerConfig {
  max_steps: number
  timeout_ms: number
  quality_threshold: number
  max_attempts: number
  skills: string[]
}

/**
 * Evaluator config — controls the deterministic per-goal check pipeline
 * (build / test / lint / spec heuristics in `delivery/checks/per-goal.ts`).
 *
 * NOTE: there is no longer an "evaluator agent" — that LLM agent was
 * collapsed into the delivery agent. What remains is purely deterministic
 * runner config: which check tier to apply and whether to run them inside
 * the goal-pool dispatch loop.
 */
export interface EvaluatorConfig {
  /** Evaluation tier: "core" (build/test/lint only), "standard" (+ judge/spec_check/code_review), "full" (all checks). Default: "standard". */
  tier?: "core" | "standard" | "full"
  /** Run the deterministic per-goal evaluator (`evaluateGoal`) inside the
   *  goal-pool dispatch loop, AFTER the executor produces a delivery and
   *  BEFORE the goal is marked passed. When false, goal-pool falls back to
   *  the legacy "executor returned OK → passed" shortcut — intended as a
   *  debugging gate so the per-goal path can be toggled while downstream
   *  code paths are being stabilized. Default: false. */
  per_goal_enabled?: boolean
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
}

export interface IntentAnalysisConfig {
  max_steps: number
  timeout_ms: number
  skills: string[]
}

export interface EngineConfigType {
  requirements: RequirementsConfig
  architect: ArchitectConfig
  planner: PlannerConfig
  evaluator: EvaluatorConfig
  delivery: DeliveryConfig
  design_analyst: DesignAnalystConfig
  intent_analysis: IntentAnalysisConfig
  max_runs: number
  max_fix_runs: number
  /** Max retries per individual goal. Goal permanently fails after this many retries. */
  max_goal_retries: number
  /** Max delivery reject → rework → re-deliver cycles before failing the task.
   *  Prevents infinite adversarial loops. Default: 3. */
  max_delivery_iterations: number
  max_executor_groups: number
  /** Default workflow ID for new tasks. Default: "pipeline". */
  default_workflow: string
  /** User-defined workflow definitions. Override built-ins by matching ID. */
  workflows: MiniWorkflow[]
}

// ═══════════════════════════════════════════════════════════════════
// 默认值定义 — 所有硬编码常量的唯一来源
// ═══════════════════════════════════════════════════════════════════

const DEFAULTS: EngineConfigType = {
  // Step / time budgets sized for sonnet-tier sub-agents on large PRDs.
  // Sonnet deliberates more per step than haiku (deeper exploration, more
  // reasoning text) and large attachments push step counts into the dozens
  // before structured output begins. The previous budgets were sized for
  // haiku and starved sonnet — observed: requirements stopped at 60 steps
  // for a 30-requirement PRD with only 2 register_goal emitted.
  requirements: {
    max_steps: 200,        // was 100 — sonnet needs headroom for PRD scan + register passes
    timeout_ms: 600_000,   // 10 min (was 5)
    quality_threshold: 0.5,
    max_attempts: 3,
    skills: [],
  },
  architect: {
    max_steps: 60,         // was 20 — ~10 goals × 2-3 contract registrations
    timeout_ms: 360_000,   // 6 min (was 3)
    skills: [],
  },
  planner: {
    max_steps: 80,         // was 30
    timeout_ms: 600_000,   // 10 min (was 5)
    quality_threshold: 0.5,
    max_attempts: 3,
    skills: [],
  },
  evaluator: {
    tier: "standard",
    // Per-goal evaluator is now the goal-exit gate (spec-09 Phase B). Path is
    // load-bearing: produces `scope="goal_run"` verification-evidence rows that
    // retry prompts (Phase C), delivery short-circuit (Phase D), and rework
    // no-progress detection (Phase E) all depend on. The original "debug gate,
    // off until stabilized" note is resolved — spec-09 is the stabilization.
    per_goal_enabled: true,
  },
  delivery: {
    // Vision-driven fig2code delivery loops compare rendered output against
    // the reference image and edit CSS/layout before producing verdict.
    // Now also runs evaluator's deterministic checks before the LLM verifies.
    max_steps: 160,        // was 80
    timeout_ms: 1_200_000, // 20 min (was 10)
    max_retries: 2,
    skills: [],
  },
  design_analyst: {
    max_steps: 80,         // was 50
    timeout_ms: 480_000,   // 8 min (was 5)
    skills: [],
  },
  intent_analysis: {
    // Short-lived front-of-pipeline agent: few slots + optional grounding
    // lookups. Budgets are intentionally tight — if it needs deeper
    // exploration, that is the job of downstream agents, not this one.
    max_steps: 20,
    timeout_ms: 120_000,   // 2 min
    skills: [],
  },
  max_runs: 15,            // was 10
  max_fix_runs: 20,
  max_goal_retries: 5,     // was 3
  max_delivery_iterations: 3,
  max_executor_groups: 5,
  default_workflow: "pipeline",
  workflows: [],
}

// ═══════════════════════════════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════════════════════════════

export namespace EngineConfig {
  /** 所有默认值，用于展示 / 对比 / 文档 */
  export const defaults: Readonly<EngineConfigType> = DEFAULTS

  /**
   * 加载完整配置：默认值 ← opencorvus.jsonc
   *
   * 每次调用都会重新读取 Config（Config 内部有缓存），
   * 因此运行时修改 opencorvus.jsonc 后下一次调用即生效。
   */
  export async function get(): Promise<EngineConfigType> {
    const cfg = await Config.get()
    return merge(cfg.assistant)
  }

  /** 同步获取硬编码默认值（不读取配置文件），用于模块初始化阶段无法 await 的场景 */
  export function getDefaults(): EngineConfigType {
    return { ...DEFAULTS }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 内部合并逻辑
// ═══════════════════════════════════════════════════════════════════

function merge(user?: Config.Info["assistant"]): EngineConfigType {
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
    },
    planner: {
      max_steps: user?.planner?.max_steps ?? DEFAULTS.planner.max_steps,
      timeout_ms: user?.planner?.timeout_ms ?? DEFAULTS.planner.timeout_ms,
      quality_threshold: user?.planner?.quality_threshold ?? DEFAULTS.planner.quality_threshold,
      max_attempts: user?.planner?.max_attempts ?? DEFAULTS.planner.max_attempts,
      skills: user?.planner?.skills ?? DEFAULTS.planner.skills,
    },
    evaluator: {
      tier: user?.evaluator?.tier ?? "standard",
      per_goal_enabled: user?.evaluator?.per_goal_enabled ?? DEFAULTS.evaluator.per_goal_enabled ?? false,
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
    },
    intent_analysis: {
      max_steps: user?.intent_analysis?.max_steps ?? DEFAULTS.intent_analysis.max_steps,
      timeout_ms: user?.intent_analysis?.timeout_ms ?? DEFAULTS.intent_analysis.timeout_ms,
      skills: user?.intent_analysis?.skills ?? DEFAULTS.intent_analysis.skills,
    },
    max_runs: user?.max_runs ?? DEFAULTS.max_runs,
    max_fix_runs: user?.max_fix_runs ?? DEFAULTS.max_fix_runs,
    max_goal_retries: user?.max_goal_retries ?? DEFAULTS.max_goal_retries,
    max_delivery_iterations: user?.max_delivery_iterations ?? DEFAULTS.max_delivery_iterations,
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
