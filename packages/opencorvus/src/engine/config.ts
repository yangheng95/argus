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
export interface DeliveryConfig {
  max_steps: number
  timeout_ms: number
  max_retries: number
  skills: string[]
  /** How many merge-conflict resolution passes the orchestrator may hand to
   *  executor before failing the goal. Each pass dispatches a build-agent
   *  session against the goal worktree — either with conflict markers
   *  present or with a retained merged tip that still fails post-merge
   *  build — and asks it to reconcile both goals' intents. Hit the cap → decision_log
   *  `merge_conflict_cap_reached` + goal failed (`retry_goal` can
   *  still re-dispatch the goal under a fresh baseRef on a later run). */
  merge_conflict_max_retries: number
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
  delivery: DeliveryConfig
  design_analyst: DesignAnalystConfig
  intent_analysis: IntentAnalysisConfig
  max_runs: number
  max_fix_runs: number
  /** Max retries per individual goal. Goal permanently fails after this many retries. */
  max_goal_retries: number
  /**
   * Advisory escalation gate: when a goal has accumulated this many failed
   * attempts, `retry_goal` forces the orchestrator to change strategy
   * (modify_goal / add_goal / fail_task) instead of retrying the same contract.
   * Must be ≤ max_goal_retries (config merge clamps to that invariant).
   */
  goal_escalation_threshold: number
  /** Hard ceiling on adversarial iteration count passed to the Arbiter's
   *  maxIterations. Once iteration >= this, the Arbiter returns `abort`
   *  regardless of other signals. Default: 3. */
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
  delivery: {
    // Vision-driven fig2code delivery loops compare rendered output against
    // the reference image and edit CSS/layout before producing verdict. Per
    // 2026-04-20 per-goal evaluator removal, delivery also owns per-goal
    // verification (runs build / test / lint / rubric specs itself via
    // run_command and parallel per-goal subagents).
    max_steps: 160,        // was 80
    timeout_ms: 1_200_000, // 20 min (was 10)
    max_retries: 2,
    skills: [],
    merge_conflict_max_retries: 2,
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
  max_goal_retries: 5,     // hard ceiling
  goal_escalation_threshold: 3,  // advisory: force strategy change after 3 failures
  max_delivery_iterations: 3,
  max_executor_groups: 1,
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
   * Contract: this namespace holds NO module-level cache of its own. Each
   * call routes through `Config.get()`, which reacts to `Config.state.reset()`
   * inside `Config.update()` (see `PATCH /config` in server/routes/config.ts).
   * Consequence: UI-driven edits to opencorvus.jsonc take effect on the very
   * next call — no restart, no explicit reset here. If a future change adds
   * a memoized field to `EngineConfig`, add a matching reset and wire it
   * into `PATCH /config`, otherwise the UI-live guarantee breaks silently.
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

/**
 * Escalation threshold must never exceed the hard retry ceiling — otherwise
 * the escalation path can never fire before `exhausted` takes over, and the
 * gate becomes dead code. Clamp once at merge time so downstream readers
 * don't each have to remember the invariant.
 */
function clampEscalationThreshold(threshold: number, maxRetries: number): number {
  return Math.min(threshold, maxRetries)
}

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
    delivery: {
      max_steps: user?.delivery?.max_steps ?? DEFAULTS.delivery.max_steps,
      timeout_ms: user?.delivery?.timeout_ms ?? DEFAULTS.delivery.timeout_ms,
      max_retries: user?.delivery?.max_retries ?? DEFAULTS.delivery.max_retries,
      skills: user?.delivery?.skills ?? DEFAULTS.delivery.skills,
      merge_conflict_max_retries:
        user?.delivery?.merge_conflict_max_retries ?? DEFAULTS.delivery.merge_conflict_max_retries,
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
    goal_escalation_threshold: clampEscalationThreshold(
      user?.goal_escalation_threshold ?? DEFAULTS.goal_escalation_threshold,
      user?.max_goal_retries ?? DEFAULTS.max_goal_retries,
    ),
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
