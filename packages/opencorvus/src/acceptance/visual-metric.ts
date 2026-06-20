/**
 * P0-B · Acceptance 硬数值门。
 *
 * LLM 无权推翻肉眼可见的差距：verdict 前先跑这里的 5 条硬门，任一 fail
 * 直接 rejected。LLM judge 只负责硬门通过后的软性瑕疵判定。
 *
 * 硬门清单（阈值由 EngineConfig.acceptance_visual 统一管理，单源，rule 25）：
 *  1. phash_hamming          — 8x8 aHash 汉明距离 ≤ T1，卡整体结构
 *  2. ssim                   — ssim.js mean SSIM ≥ T2，卡纹理/细节
 *  3. chart_region_density   — 非白像素密度 ≥ reference × 0.6，卡空骨架
 *  4. unique_color_ratio     — 唯一色桶数 ≥ reference × 0.5，卡单色页
 *  5. text_hit_ratio         — reference OCR 文本在 rendered 的命中率 ≥ 0.7
 *
 * 第 5 条的 OCR/anchor 来自 CaptureManifest.reference_strings。缺少 reference
 * strings 或 rendered text 表示硬门证据缺失，必须失败，不能把占位文案风险
 * 伪装成通过。
 *
 * 消费者：P0-B（verdict 硬门）、P0-C.4（LKG 回滚比较 score）、P2（replay 曲线）。
 */
import z from "zod"
import ssim from "ssim.js"
import { EngineConfig } from "@/engine/config"
import { decodePNG, nonWhiteDensity, uniqueColorBucketCount, type DecodedPNG } from "@/util/pixel-stats"

/** 每一条硬门的判定记录。 */
export interface VisualGateResult {
  name: VisualGateName
  passed: boolean
  threshold: number
  value: number
  note: string
}

export type VisualGateName = "phash_hamming" | "ssim" | "chart_region_density" | "unique_color_ratio" | "text_hit_ratio"

export interface VisualMetricResult {
  passed: boolean
  score: number
  gates: VisualGateResult[]
  diffRegionPath?: string
  renderedPath: string
  referencePath: string
  capturedAt: number
}

export const VisualThresholds = z.object({
  phash_hamming_max: z.number().int().min(0).max(64),
  ssim_min: z.number().min(0).max(1),
  chart_region_density_min_ratio: z.number().min(0).max(1),
  unique_color_ratio_min: z.number().min(0).max(1),
  text_hit_ratio_min: z.number().min(0).max(1),
  score_weights: z.object({
    phash: z.number().min(0).max(1),
    ssim: z.number().min(0).max(1),
    density: z.number().min(0).max(1),
    text_hit: z.number().min(0).max(1),
  }),
})
export type VisualThresholdsType = z.infer<typeof VisualThresholds>

/**
 * 从 EngineConfig.acceptance_visual 读取阈值，zod 校验 + score_weights sum-to-1 校验。
 * 单源配置（rule 22 / rule 25）。
 *
 * 故意用同步 `getDefaults()`：保持既有调用处 `loadVisualThresholds()` 签名
 * 不变，避免跨文件协同改 await。DEFAULTS 即是唯一事实源；待需要支持
 * opencorvus.jsonc 实时覆盖时再改 async + 同步更新两个调用点。
 */
export function loadVisualThresholds(): VisualThresholdsType {
  const cfg = EngineConfig.getDefaults().acceptance_visual
  const parsed = VisualThresholds.parse(cfg)
  const { phash, ssim: ssimW, density, text_hit } = parsed.score_weights
  const sum = phash + ssimW + density + text_hit
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`visual-metric: score_weights must sum to 1, got ${sum.toFixed(4)}`)
  }
  return parsed
}

// ---------------------------------------------------------------------------
// 核心计算
// ---------------------------------------------------------------------------

/** Bilinear resize for 8-bit RGBA. 用于 aHash 与 SSIM 尺寸归一。 */
function resizeRGBA(src: DecodedPNG, targetW: number, targetH: number): DecodedPNG {
  if (src.width === targetW && src.height === targetH) return src
  const out = Buffer.alloc(targetW * targetH * 4)
  const xRatio = src.width / targetW
  const yRatio = src.height / targetH
  for (let y = 0; y < targetH; y++) {
    const sy = y * yRatio
    const y0 = Math.floor(sy)
    const y1 = Math.min(y0 + 1, src.height - 1)
    const yT = sy - y0
    for (let x = 0; x < targetW; x++) {
      const sx = x * xRatio
      const x0 = Math.floor(sx)
      const x1 = Math.min(x0 + 1, src.width - 1)
      const xT = sx - x0
      for (let c = 0; c < 4; c++) {
        const p00 = src.data[(y0 * src.width + x0) * 4 + c]
        const p01 = src.data[(y0 * src.width + x1) * 4 + c]
        const p10 = src.data[(y1 * src.width + x0) * 4 + c]
        const p11 = src.data[(y1 * src.width + x1) * 4 + c]
        const top = p00 * (1 - xT) + p01 * xT
        const bot = p10 * (1 - xT) + p11 * xT
        out[(y * targetW + x) * 4 + c] = Math.round(top * (1 - yT) + bot * yT)
      }
    }
  }
  return { width: targetW, height: targetH, data: out }
}

/** 8x8 平均哈希。返回 64 位值（BigInt），可与另一个 hash 用 popcount(XOR) 求汉明距离。 */
function averageHash(img: DecodedPNG): bigint {
  const small = resizeRGBA(img, 8, 8)
  const gray = new Float32Array(64)
  let sum = 0
  for (let i = 0; i < 64; i++) {
    const r = small.data[i * 4]
    const g = small.data[i * 4 + 1]
    const b = small.data[i * 4 + 2]
    // Rec. 601 luma，与浏览器默认 tone mapping 接近。
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    gray[i] = y
    sum += y
  }
  const avg = sum / 64
  let hash = 0n
  for (let i = 0; i < 64; i++) {
    if (gray[i] > avg) hash |= 1n << BigInt(i)
  }
  return hash
}

function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b
  let count = 0
  while (x > 0n) {
    if (x & 1n) count++
    x >>= 1n
  }
  return count
}

/**
 * reference OCR 文本在 rendered 的命中率。Stream C 不内嵌 OCR；调用方通过
 * renderedText 传入：Stream A (P0-0) 附带 rendered 页的 innerText 即可；
 * referenceStrings 由 CaptureManifest 权威产出。两者任一缺失该硬门失败。
 */
function textHitRatio(
  referenceStrings: readonly string[] | undefined,
  renderedText: string | undefined,
): number | null {
  if (!referenceStrings || referenceStrings.length === 0) return null
  if (typeof renderedText !== "string") return null
  const haystack = renderedText.toLowerCase()
  let hits = 0
  for (const s of referenceStrings) {
    const needle = s.trim().toLowerCase()
    if (needle.length === 0) continue
    if (haystack.includes(needle)) hits++
  }
  return hits / referenceStrings.length
}

export async function computeVisualMetric(input: {
  renderedPath: string
  referencePath: string
  chartRegion?: { x: number; y: number; width: number; height: number }
  referenceStrings?: string[]
  renderedText?: string
  thresholds: VisualThresholdsType
}): Promise<VisualMetricResult> {
  const [rendered, reference] = await Promise.all([decodePNG(input.renderedPath), decodePNG(input.referencePath)])
  const t = input.thresholds

  // ---- 1. pHash 汉明距离 -------------------------------------------------
  const hashR = averageHash(rendered)
  const hashRef = averageHash(reference)
  const hamming = hammingDistance(hashR, hashRef)
  const phashGate: VisualGateResult = {
    name: "phash_hamming",
    passed: hamming <= t.phash_hamming_max,
    threshold: t.phash_hamming_max,
    value: hamming,
    note:
      hamming <= t.phash_hamming_max
        ? ""
        : `aHash hamming=${hamming} > ${t.phash_hamming_max} — 整体结构与 reference 偏差过大`,
  }

  // ---- 2. SSIM -----------------------------------------------------------
  // ssim.js 要求相同尺寸——rendered 强制归一到 reference。
  const rendForSsim = resizeRGBA(rendered, reference.width, reference.height)
  const { mssim } = ssim(
    { data: rendForSsim.data as unknown as Uint8ClampedArray, width: rendForSsim.width, height: rendForSsim.height },
    { data: reference.data as unknown as Uint8ClampedArray, width: reference.width, height: reference.height },
  )
  const ssimGate: VisualGateResult = {
    name: "ssim",
    passed: mssim >= t.ssim_min,
    threshold: t.ssim_min,
    value: mssim,
    note: mssim >= t.ssim_min ? "" : `SSIM=${mssim.toFixed(3)} < ${t.ssim_min} — 纹理/细节差距过大`,
  }

  // ---- 3. chart-region 非白密度比 ---------------------------------------
  const refDensity = nonWhiteDensity(reference, input.chartRegion)
  const rendDensity = nonWhiteDensity(
    // density 对 reference 的 bbox 适用；rendered 归一到 reference 尺寸后用同 bbox。
    rendForSsim,
    input.chartRegion,
  )
  const densityRatio = refDensity === 0 ? 0 : rendDensity / refDensity
  const densityGate: VisualGateResult = {
    name: "chart_region_density",
    passed: densityRatio >= t.chart_region_density_min_ratio,
    threshold: t.chart_region_density_min_ratio,
    value: densityRatio,
    note:
      densityRatio >= t.chart_region_density_min_ratio
        ? ""
        : `rendered 非白像素密度=${rendDensity.toFixed(3)} vs reference=${refDensity.toFixed(3)} → ratio=${densityRatio.toFixed(3)} < ${t.chart_region_density_min_ratio}（疑似空骨架）`,
  }

  // ---- 4. 唯一色桶比 -----------------------------------------------------
  const refColors = uniqueColorBucketCount(reference)
  const rendColors = uniqueColorBucketCount(rendForSsim)
  const colorRatio = refColors === 0 ? 0 : rendColors / refColors
  const colorGate: VisualGateResult = {
    name: "unique_color_ratio",
    passed: colorRatio >= t.unique_color_ratio_min,
    threshold: t.unique_color_ratio_min,
    value: colorRatio,
    note:
      colorRatio >= t.unique_color_ratio_min
        ? ""
        : `唯一色桶数 rendered=${rendColors} / reference=${refColors} → ratio=${colorRatio.toFixed(3)} < ${t.unique_color_ratio_min}（疑似单色/占位页）`,
  }

  // ---- 5. text hit ratio (P1-B 提供 anchors 后生效) ---------------------
  const textValue = textHitRatio(input.referenceStrings, input.renderedText)
  const textGate: VisualGateResult =
    textValue === null
      ? {
          name: "text_hit_ratio",
          passed: false,
          threshold: t.text_hit_ratio_min,
          value: Number.NaN,
          note: "missing required referenceStrings/renderedText evidence for text_hit_ratio hard gate",
        }
      : {
          name: "text_hit_ratio",
          passed: textValue >= t.text_hit_ratio_min,
          threshold: t.text_hit_ratio_min,
          value: textValue,
          note:
            textValue >= t.text_hit_ratio_min
              ? ""
              : `reference 字符串命中率=${(textValue * 100).toFixed(1)}% < ${(t.text_hit_ratio_min * 100).toFixed(0)}%（疑似占位文案）`,
        }

  const gates = [phashGate, ssimGate, densityGate, colorGate, textGate]
  const passed = gates.every((g) => g.passed)

  // ---- 复合 score (LKG 回滚比较用，越大越好，范围 [0,1]) --------------
  const phashNorm = Math.max(0, 1 - hamming / 32) // 32 位差异 = 0 分
  const ssimNorm = Math.max(0, Math.min(1, mssim))
  const densityNorm = Math.max(0, Math.min(1, densityRatio))
  const wP = t.score_weights.phash
  const wS = t.score_weights.ssim
  const wD = t.score_weights.density
  const textComponent = t.score_weights.text_hit * Math.max(0, Math.min(1, textValue ?? 0))
  const score = wP * phashNorm + wS * ssimNorm + wD * densityNorm + textComponent

  return {
    passed,
    score,
    gates,
    renderedPath: input.renderedPath,
    referencePath: input.referencePath,
    capturedAt: Date.now(),
  }
}

/**
 * 格式化成一行人类可读摘要，嵌入 verdict.rejection_details[].error 里。
 */
export function summarizeVisualMetric(metric: VisualMetricResult): string {
  const failed = metric.gates.filter((g) => !g.passed)
  if (failed.length === 0) {
    return "visual metric diagnostics found no blocking difference"
  }
  return (
    "visual metric diagnostics found differences: " +
    failed.map((g) => `${g.name}=${g.value} vs ${g.threshold}`).join("; ")
  )
}
