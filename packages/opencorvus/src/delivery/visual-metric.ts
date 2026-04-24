/**
 * P0-B · Delivery 硬数值门契约（stub，先于 Stream C 合入）。
 *
 * 该文件仅定义 VisualMetric 的 TS 类型 + thresholds 加载约定；
 * 实际计算（pHash / SSIM / chart-region 密度 / 唯一色比 / 命中率 / 复合 score）
 * 由 Stream C（P0-B）在 packages/opencorvus/src/delivery/ 下实现。
 *
 * 消费者：P0-B（verdict 硬门）、P0-C.4（LKG score-driven 回滚）、P2（replay）。
 *
 * 契约要点（不可变）：
 *  - 数值门在 LLM judge 之前；任一 gate fail ⇒ verdict=rejected，LLM 无权推翻。
 *  - 阈值以 JSON 落盘，允许按样本标定刷新，但文件结构恒定（VisualThresholds）。
 *  - 复合 score 单调：越大越好；用于 LKG 回滚比较。
 */
import z from "zod"
import path from "node:path"

/** 每一条硬门的判定记录。通过即 passed=true；失败时 value 须给出实际观测。 */
export interface VisualGateResult {
  name: VisualGateName
  passed: boolean
  threshold: number
  value: number
  /** 人类可读的失败原因；passed=true 时应为空串。 */
  note: string
}

/** 硬门名称白名单（stub 阶段写死；若扩展须先改 VisualThresholds 结构，避免 drift）。 */
export type VisualGateName =
  | "phash_hamming"
  | "ssim"
  | "chart_region_density"
  | "unique_color_ratio"
  | "text_hit_ratio"

/** 单次渲染 vs reference 的全部硬门结果 + 复合分数。 */
export interface VisualMetricResult {
  /** 所有硬门都 passed 才为 true。 */
  passed: boolean
  /** 复合评分，用于 LKG 比较。单调：越大越好，范围 [0,1]。 */
  score: number
  /** 每条硬门的逐项结果（顺序与 VisualGateName 一致）。 */
  gates: VisualGateResult[]
  /** 被高亮的差异区域图路径（若该轮生成），供 verdict 附在 rejection 里。 */
  diffRegionPath?: string
  /** 当轮 rendered PNG 绝对路径（作为 LKG 快照 anchor）。 */
  renderedPath: string
  /** 对比用的 reference PNG 绝对路径。 */
  referencePath: string
  /** 采集时间戳，ms。 */
  capturedAt: number
}

/** 阈值文件 schema。Stream C 合入时需在 visual-thresholds.json 中填具体数值。 */
export const VisualThresholds = z.object({
  phash_hamming_max: z.number().int().min(0).max(64)
    .describe("pHash 汉明距离上限（越小越相似）"),
  ssim_min: z.number().min(0).max(1)
    .describe("SSIM 下限（越大越相似）"),
  chart_region_density_min_ratio: z.number().min(0).max(1)
    .describe("chart 区非白像素密度下限（相对 reference 的比例，默认 0.6 卡空骨架）"),
  unique_color_ratio_min: z.number().min(0).max(1)
    .describe("唯一色数占 reference 的比例下限（默认 0.5 卡单色页）"),
  text_hit_ratio_min: z.number().min(0).max(1)
    .describe("reference 文字串在 rendered 的命中率下限（默认 0.7 卡占位文案）"),
  /** 复合 score 的加权系数，须相加为 1（运行时校验）。 */
  score_weights: z.object({
    phash: z.number().min(0).max(1),
    ssim: z.number().min(0).max(1),
    density: z.number().min(0).max(1),
    text_hit: z.number().min(0).max(1),
  }),
})
export type VisualThresholdsType = z.infer<typeof VisualThresholds>

/** 阈值文件标准落盘路径（相对 opencorvus 源码根）。 */
export const VISUAL_THRESHOLDS_RELATIVE = "src/delivery/visual-thresholds.json"

/**
 * 加载并校验阈值配置。Stub 实现：未准备就绪时抛错，不提供 fallback 默认值
 * （符合 CLAUDE.md rule 1：禁 fallback）。Stream C 合入时由其补齐文件。
 */
export async function loadVisualThresholds(absolutePath?: string): Promise<VisualThresholdsType> {
  const target = absolutePath ?? path.resolve(process.cwd(), "packages/opencorvus", VISUAL_THRESHOLDS_RELATIVE)
  const fs = await import("node:fs/promises")
  let raw: string
  try {
    raw = await fs.readFile(target, "utf8")
  } catch (err) {
    throw new Error(
      `visual-metric: thresholds file missing at ${target}. ` +
      `P0-B (Stream C) must commit ${VISUAL_THRESHOLDS_RELATIVE} before numeric gate can run. ` +
      `Cause: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  const parsed = VisualThresholds.parse(JSON.parse(raw))
  const sum = parsed.score_weights.phash + parsed.score_weights.ssim +
    parsed.score_weights.density + parsed.score_weights.text_hit
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`visual-metric: score_weights must sum to 1, got ${sum.toFixed(4)}`)
  }
  return parsed
}

/**
 * 计算 rendered vs reference 的硬门结果 + 复合 score。
 * Stub：抛 NotImplementedError，Stream C (P0-B) 合入真实实现。
 */
export async function computeVisualMetric(_input: {
  renderedPath: string
  referencePath: string
  /** reference 的 chart 区域 bbox（由 CaptureManifest 提供）；缺失则退化为全图密度比较。 */
  chartRegion?: { x: number; y: number; width: number; height: number }
  /** reference 文字串（由 CaptureManifest.reference_strings 提供）；缺失则 text_hit_ratio gate 跳过。 */
  referenceStrings?: string[]
  thresholds: VisualThresholdsType
}): Promise<VisualMetricResult> {
  throw new Error(
    "visual-metric: computeVisualMetric not yet implemented — P0-B (Stream C) scope. " +
    "This stub exists only to lock the return-type contract for P0-C.4 (LKG) and P2 (replay).",
  )
}
