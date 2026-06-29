/**
 * P1-B · Content fingerprint（Stream F）。
 *
 * 只读消费 P0-A 的 CaptureManifest 里的权威锚点（reference_strings / palette /
 * layout），在 rendered 产物（HTML innerText + PNG + getBoundingClientRect 结果）
 * 上计算命中率——取代 goal-agent 自造 `test -f` + `grep` 规则那条不可靠路径。
 *
 * 消费者（未来）：
 *  - goal 验收 checks_run 新增 `content_fingerprint` 检查项
 *  - integrity review 作为运行时内容证据
 *
 * 契约（CLAUDE.md）：
 *  - rule 1：锚点必须来自 manifest，缺失直接抛错，不 fallback 到关键字搜索
 *  - rule 11：禁自造 grep 规则——本模块只做"预先由 reference capture 记录的串"的字面匹配
 *  - rule 22：不与 visual-metric.ts 的 text_hit_ratio 重复实现 OCR——那个 visual
 *    metric 用同一 reference_strings 数组，本模块只在"软判"维度复用，计算方式相同
 *  - rule 26：不搞近似匹配 / fuzzy；normalize 到 lowercase + collapse 空白即可，
 *    其余质量由 capture 侧的串质量保证
 *
 * 本轮只实装计算 API，不修 goal 验收入口（那属于 check registry 重构，独立工单）。
 */
import fs from "node:fs/promises"
import { CaptureManifest, type CaptureManifestType, type CaptureBboxType } from "@/frontend-design/reference-capture"

/** 从 manifest.json 路径加载 + zod 校验；格式错直接抛，禁 fallback。 */
export async function loadContentAnchors(manifestPath: string): Promise<CaptureManifestType> {
  const raw = await fs.readFile(manifestPath, "utf8")
  return CaptureManifest.parse(JSON.parse(raw))
}

/** 归一化：小写 + 合并空白 + 去标点边缘。不做语言学处理。 */
function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, "")
    .trim()
}

/** reference_strings 的命中率：非空 trimmed 串出现在 rendered innerText 里记一次。 */
export function computeStringHitRatio(referenceStrings: readonly string[], renderedText: string): number {
  const haystack = normalizeText(renderedText)
  if (haystack.length === 0) return 0
  let hits = 0
  let considered = 0
  for (const raw of referenceStrings) {
    const needle = normalizeText(raw)
    if (needle.length === 0) continue
    considered++
    if (haystack.includes(needle)) hits++
  }
  return considered === 0 ? 0 : hits / considered
}

/**
 * palette Jaccard：reference 与 rendered 的 4bit-bucket palette 集合交并比。
 * 调用方应把 rendered PNG 经 `util/pixel-stats.topKPalette` 取 top-K（与 reference 同
 * K 值），再传进来——本模块只做集合比较，不再重算像素。
 */
export function computePaletteJaccard(referencePalette: readonly string[], renderedPalette: readonly string[]): number {
  const ref = new Set(referencePalette.map((c) => c.toLowerCase()))
  const ren = new Set(renderedPalette.map((c) => c.toLowerCase()))
  if (ref.size === 0 && ren.size === 0) return 1
  let inter = 0
  for (const c of ref) if (ren.has(c)) inter++
  const union = ref.size + ren.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * layout 重叠率：对 manifest.layout 里的每个命名区域（chart/sidebar/...），
 * 看 rendered DOM 里同名区域的 bbox 是否与 reference bbox IoU ≥ threshold。
 *
 * rendered bbox 由调用方从页面 `getBoundingClientRect` 抓好（browser 注入）；
 * 本模块不自己跑浏览器——保持单一职责（rule 22）。
 *
 * 返回 per-region IoU + 总平均；缺失的 region 记 IoU=0 并计入 denominator，
 * 因为"应有区域没出现"是空骨架的典型信号（ainvest 事故）。
 */
export interface LayoutOverlapResult {
  perRegion: Record<string, { iou: number; reference: CaptureBboxType; rendered: CaptureBboxType | null }>
  averageIoU: number
}

export function computeLayoutOverlap(
  referenceLayout: Record<string, CaptureBboxType>,
  renderedLayout: Record<string, CaptureBboxType | null | undefined>,
): LayoutOverlapResult {
  const perRegion: LayoutOverlapResult["perRegion"] = {}
  const names = Object.keys(referenceLayout)
  if (names.length === 0) return { perRegion, averageIoU: 1 }
  let total = 0
  for (const name of names) {
    const ref = referenceLayout[name]
    const ren = renderedLayout[name] ?? null
    const iou = ren ? bboxIoU(ref, ren) : 0
    perRegion[name] = { iou, reference: ref, rendered: ren }
    total += iou
  }
  return { perRegion, averageIoU: total / names.length }
}

function bboxIoU(a: CaptureBboxType, b: CaptureBboxType): number {
  const ax2 = a.x + a.width
  const ay2 = a.y + a.height
  const bx2 = b.x + b.width
  const by2 = b.y + b.height
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x))
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y))
  const inter = ix * iy
  const union = a.width * a.height + b.width * b.height - inter
  return union <= 0 ? 0 : inter / union
}

// ---------------------------------------------------------------------------
// Evaluate 顶层 API
// ---------------------------------------------------------------------------

export interface ContentFingerprintInput {
  manifest: CaptureManifestType
  rendered: {
    /** Rendered 页面 innerText（DOM text + 可选 OCR 合并）。 */
    text: string
    /** Rendered PNG 的 top-K palette（K 应等于 manifest.palette.length）。 */
    palette: readonly string[]
    /** Rendered 的命名区域 bbox；缺失的 region 记为 null。 */
    layout: Record<string, CaptureBboxType | null | undefined>
  }
  /** Explicit IoU 下限判 "区域到位"；不影响 averageIoU 计算，仅用于 per-region passed 标。 */
  regionIouThreshold: number
}

export interface ContentFingerprintResult {
  stringHitRatio: number
  paletteJaccard: number
  layout: LayoutOverlapResult
  /** per-region is IoU ≥ threshold。 */
  regionPassedMask: Record<string, boolean>
}

export function evaluateContentFingerprint(input: ContentFingerprintInput): ContentFingerprintResult {
  const threshold = Number(input.regionIouThreshold)
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`content fingerprint regionIouThreshold must be in (0, 1], got ${input.regionIouThreshold}`)
  }
  const layout = computeLayoutOverlap(input.manifest.layout, input.rendered.layout)
  const regionPassedMask: Record<string, boolean> = {}
  for (const [name, entry] of Object.entries(layout.perRegion)) {
    regionPassedMask[name] = entry.iou >= threshold
  }
  return {
    stringHitRatio: computeStringHitRatio(input.manifest.reference_strings, input.rendered.text),
    paletteJaccard: computePaletteJaccard(input.manifest.palette, input.rendered.palette),
    layout,
    regionPassedMask,
  }
}
