/**
 * EngineConfig — 编排 agent 的统一配置中心
 *
 * 所有 agent（requirements / architect / integrity）和编排策略的默认值
 * 集中定义在此，并从 opencorvus.jsonc 的 `assistant` 字段加载用户自定义值。
 *
 * 优先级：opencorvus.jsonc > 此处硬编码默认值
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

interface RequirementsConfig {
  max_steps: number
}

interface ArchitectConfig {
  max_steps: number
}

interface FrontendDesignConfig {
  max_steps: number
}

interface IntentAnalysisConfig {
  max_steps: number
}

interface BuildConfig {
  max_steps: number
}

/**
 * ActivityConfig — chunk-driven inactivity thresholds.
 *
 * These drive `withStreamActivity` (util/stream-activity.ts) at every
 * streaming boundary. They are TCP-level "no-byte-moved" deadlines,
 * NOT agent-level turn budgets. Rule of thumb when tuning:
 *
 *   session_llm_idle_ms      < executor_events_idle_ms
 *
 * so the LLM-stream gate trips first (producing a clean AbortError
 * the session loop already knows how to unwind), and the executor-event
 * gate only trips when the LLM layer failed to do so.
 *
 * Phase-6-d-0: `goal_run_idle_ms` + goal-run-watchdog scanner deleted
 * (rule 23 FSM wall-clock driver duplicating the two inner gates).
 *
 * `task_queue_run_timeout_ms` is the max no-activity window for a
 * single queue task — measured from the last observed chunk-driven
 * heartbeat, NOT from process start or an unconditional setInterval.
 * See scheduler/task-queue-service.ts.
 */
interface ActivityConfig {
  session_llm_idle_ms: number
  executor_events_idle_ms: number
  task_queue_run_timeout_ms: number
}

/**
 * AcceptanceVisualConfig — P0-B visual metric 阈值 + 复合 score 权重。
 *
 * 单源化：所有阈值都在 EngineConfig 下统一管理（rule 25 禁散配置文件），
 * 用户可通过 opencorvus.jsonc `assistant.acceptance_visual` 覆盖。改动阈值
 * 后需在下一次 benchmark 跑中重新评估 accept/reject 分布。
 *
 * score_weights 四项相加必须为 1（运行时校验）；score 的单调性是 P0-C.4
 * LKG 回滚比较的语义基础，禁止破坏。
 */
interface AcceptanceVisualConfig {
  /** aHash 8×8 汉明距离上限；越小越相似。 */
  phash_hamming_max: number
  /** mean SSIM 下限；越大越相似。 */
  ssim_min: number
  /** chart 区非白像素密度相对 reference 的下限；卡空骨架关键指标。 */
  chart_region_density_min_ratio: number
  /** 4bit-bucket 唯一色数比例下限；卡单色占位页。 */
  unique_color_ratio_min: number
  /** reference_strings 在 rendered 的命中率下限；卡占位文案。 */
  text_hit_ratio_min: number
  /** 复合 score 加权（sum-to-1 强制）。 */
  score_weights: {
    phash: number
    ssim: number
    density: number
    text_hit: number
  }
}

export interface EngineConfigType {
  requirements: RequirementsConfig
  architect: ArchitectConfig
  acceptance_visual: AcceptanceVisualConfig
  frontend_design: FrontendDesignConfig
  intent_analysis: IntentAnalysisConfig
  build: BuildConfig
  activity: ActivityConfig
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
  // Step budgets sized for sonnet-tier sub-agents on large templates.
  // Sonnet deliberates more per step than haiku (deeper exploration, more
  // reasoning text) and large attachments push step counts into the dozens
  // before structured output begins. The previous budgets were sized for
  // haiku and starved sonnet — observed: requirements stopped at 60 steps
  // for a 30-requirement template with only 2 register_goal emitted.
  requirements: {
    max_steps: 1000,
  },
  architect: {
    max_steps: 1000,
  },
  acceptance_visual: {
    // 经验值基线（ainvest 事故复盘 2026-04-24）。后续用 dev/ accept/reject
    // 样本标定时，改这里即可，其它代码路径不需要改。
    phash_hamming_max: 18,
    ssim_min: 0.85,
    chart_region_density_min_ratio: 0.6,
    unique_color_ratio_min: 0.5,
    text_hit_ratio_min: 0.7,
    score_weights: {
      phash: 0.25,
      ssim: 0.35,
      density: 0.25,
      text_hit: 0.15,
    },
  },
  frontend_design: {
    max_steps: 1000,
  },
  intent_analysis: {
    max_steps: 1000,
  },
  build: {
    max_steps: 1000,
  },
  activity: {
    // Reasoning models can stream reasoning deltas every few seconds;
    // 3 min of zero chunks is already anomalous (observed cases: TCP
    // hang to alibaba-coding-plan-cn, NAT-silenced connection).
    session_llm_idle_ms: 180_000,
    // Executor event queue aggregates LLM streams + tool updates. Gets
    // one tier of slack on top of LLM to avoid races between the two
    // gates firing at the same instant.
    executor_events_idle_ms: 240_000,
    // TaskQueueService recover() compares against this. The scheduler
    // heartbeat is chunk-driven now, so this is a real deadline, not
    // a self-fed timer.
    task_queue_run_timeout_ms: 600_000,
  },
  max_executor_groups: 3,
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

function merge(user?: Config.Info["assistant"]): EngineConfigType {
  return {
    requirements: {
      max_steps: user?.requirements?.max_steps ?? DEFAULTS.requirements.max_steps,
    },
    architect: {
      max_steps: user?.architect?.max_steps ?? DEFAULTS.architect.max_steps,
    },
    acceptance_visual: {
      phash_hamming_max: user?.acceptance_visual?.phash_hamming_max ?? DEFAULTS.acceptance_visual.phash_hamming_max,
      ssim_min: user?.acceptance_visual?.ssim_min ?? DEFAULTS.acceptance_visual.ssim_min,
      chart_region_density_min_ratio:
        user?.acceptance_visual?.chart_region_density_min_ratio ??
        DEFAULTS.acceptance_visual.chart_region_density_min_ratio,
      unique_color_ratio_min:
        user?.acceptance_visual?.unique_color_ratio_min ?? DEFAULTS.acceptance_visual.unique_color_ratio_min,
      text_hit_ratio_min: user?.acceptance_visual?.text_hit_ratio_min ?? DEFAULTS.acceptance_visual.text_hit_ratio_min,
      score_weights: {
        phash: user?.acceptance_visual?.score_weights?.phash ?? DEFAULTS.acceptance_visual.score_weights.phash,
        ssim: user?.acceptance_visual?.score_weights?.ssim ?? DEFAULTS.acceptance_visual.score_weights.ssim,
        density: user?.acceptance_visual?.score_weights?.density ?? DEFAULTS.acceptance_visual.score_weights.density,
        text_hit: user?.acceptance_visual?.score_weights?.text_hit ?? DEFAULTS.acceptance_visual.score_weights.text_hit,
      },
    },
    frontend_design: {
      max_steps: user?.frontend_design?.max_steps ?? DEFAULTS.frontend_design.max_steps,
    },
    intent_analysis: {
      max_steps: user?.intent_analysis?.max_steps ?? DEFAULTS.intent_analysis.max_steps,
    },
    build: {
      max_steps: user?.build?.max_steps ?? DEFAULTS.build.max_steps,
    },
    activity: {
      session_llm_idle_ms: user?.activity?.session_llm_idle_ms ?? DEFAULTS.activity.session_llm_idle_ms,
      executor_events_idle_ms: user?.activity?.executor_events_idle_ms ?? DEFAULTS.activity.executor_events_idle_ms,
      task_queue_run_timeout_ms:
        user?.activity?.task_queue_run_timeout_ms ?? DEFAULTS.activity.task_queue_run_timeout_ms,
    },
    max_executor_groups: user?.max_executor_groups ?? DEFAULTS.max_executor_groups,
    default_workflow: user?.default_workflow ?? DEFAULTS.default_workflow,
    workflows: (user?.workflows ?? DEFAULTS.workflows).map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description ?? "",
      steps: w.steps.map((s) => ({
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
