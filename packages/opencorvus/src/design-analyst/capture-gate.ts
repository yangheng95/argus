/**
 * P0-A · Reference 真实性闸契约（stub，先于 Stream B 合入）。
 *
 * 此文件只定义 CaptureManifest 的 zod schema + gate 函数签名；
 * puppeteer/CDP 抓图、HAR 采集、像素统计、OCR 等实际逻辑由 Stream B (P0-A) 实现。
 *
 * 消费者：
 *  - P0-A (Stream B) 自身：抓图落盘后调用 enforceCaptureGate。
 *  - P1-A (Stream E)：evaluator 的 runtime-evidence 复用 puppeteer helper。
 *  - P1-B (Stream F)：content-fingerprint 读取 manifest.reference_strings / palette / layout。
 *
 * 契约要点（不可变）：
 *  - 抓图失败 ⇒ 直接 rejected，禁止走 visual contract 文本退路（rule 1：no fallback）。
 *  - Gate 阈值写死为常量（stub 阶段），便于所有 stream 同步参考；
 *    若需可配置化迁往 JSON，由 Stream B 处理，但字段名不得变。
 */
import z from "zod"

/** Chart / sidebar / toolbar 等关键区域的 bbox（CSS 像素）。 */
export const CaptureBbox = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})
export type CaptureBboxType = z.infer<typeof CaptureBbox>

/**
 * Design-analyst 采集阶段产出的权威 manifest。
 * 作为下游 goal / delivery / evaluator 的只读事实源（禁自造锚点，rule 11）。
 */
export const CaptureManifest = z.object({
  /** 被采集的目标 URL。file:// 与 data: 均不接受（必须真实 http(s)）。 */
  url: z.string().url(),
  /** 采集时使用的视口。 */
  viewport: z.object({
    width: z.number().int().min(100).max(4096),
    height: z.number().int().min(100).max(4096),
    device_scale_factor: z.number().min(0.5).max(4).default(1),
  }),
  /** 采集时间戳（ms）。 */
  captured_at: z.number().int(),
  /** 采集总耗时（ms）。 */
  duration_ms: z.number().int().min(0),

  /** fullpage 截图 sha256。 */
  screenshot_sha256: z.string().length(64),
  /** DOM outerHTML 序列化后 sha256。 */
  dom_sha256: z.string().length(64),

  /** 截图字节数；gate 下限见 CAPTURE_GATE_THRESHOLDS.min_byte_size。 */
  screenshot_byte_size: z.number().int().min(0),
  /** HAR 归档字节数（所有请求+响应）。 */
  har_byte_size: z.number().int().min(0),

  /** 非白像素占比；gate 下限见 CAPTURE_GATE_THRESHOLDS.min_non_white_pixel_ratio。 */
  non_white_pixel_ratio: z.number().min(0).max(1),
  /** 量化后唯一色数；gate 下限见 CAPTURE_GATE_THRESHOLDS.min_unique_color_count。 */
  unique_color_count: z.number().int().min(0),
  /** OCR + DOM 文本汇总字符数。 */
  text_length: z.number().int().min(0),

  /** 供 P1-B content-fingerprint 消费的文字串集合（OCR + DOM innerText）。 */
  reference_strings: z.array(z.string().min(1)),
  /** 供 P1-B content-fingerprint 消费的主色调色板（top-K，十六进制字符串）。 */
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)),
  /** 供 P0-B chart-region density + P1-B layout fingerprint 消费的命名区域 bbox。 */
  layout: z.record(z.string(), CaptureBbox),

  /** 抓图时用到的 puppeteer/CDP 等工具版本，便于 replay 比对。 */
  tool_version: z.object({
    puppeteer: z.string().optional(),
    chrome: z.string().optional(),
  }),
})
export type CaptureManifestType = z.infer<typeof CaptureManifest>

/** Gate 阈值（stub 写死；Stream B 若要调节须保持字段名恒定）。 */
export const CAPTURE_GATE_THRESHOLDS = {
  min_byte_size: 20_480,
  min_non_white_pixel_ratio: 0.05,
  min_unique_color_count: 16,
} as const

/** Gate 命中的具体原因，用于 rejection artifact。 */
export interface CaptureGateViolation {
  field: "screenshot_byte_size" | "non_white_pixel_ratio" | "unique_color_count"
  threshold: number
  observed: number
}

/**
 * 校验 CaptureManifest 是否满足真实性闸。
 * - 通过：返回 { ok: true, manifest }
 * - 失败：返回 { ok: false, violations } —— 调用方必须直接走 task=failed，
 *   禁止做任何 fallback 或静态文本退路（rule 1）。
 * Stub：仅做阈值比较；Stream B 可扩展（例如 SPA waitForFunction 结果验证）。
 */
export function enforceCaptureGate(manifest: CaptureManifestType):
  | { ok: true; manifest: CaptureManifestType }
  | { ok: false; violations: CaptureGateViolation[] } {
  const violations: CaptureGateViolation[] = []
  if (manifest.screenshot_byte_size < CAPTURE_GATE_THRESHOLDS.min_byte_size) {
    violations.push({
      field: "screenshot_byte_size",
      threshold: CAPTURE_GATE_THRESHOLDS.min_byte_size,
      observed: manifest.screenshot_byte_size,
    })
  }
  if (manifest.non_white_pixel_ratio < CAPTURE_GATE_THRESHOLDS.min_non_white_pixel_ratio) {
    violations.push({
      field: "non_white_pixel_ratio",
      threshold: CAPTURE_GATE_THRESHOLDS.min_non_white_pixel_ratio,
      observed: manifest.non_white_pixel_ratio,
    })
  }
  if (manifest.unique_color_count < CAPTURE_GATE_THRESHOLDS.min_unique_color_count) {
    violations.push({
      field: "unique_color_count",
      threshold: CAPTURE_GATE_THRESHOLDS.min_unique_color_count,
      observed: manifest.unique_color_count,
    })
  }
  if (violations.length > 0) return { ok: false, violations }
  return { ok: true, manifest }
}

/**
 * 采集 + 生成 manifest。Stub：抛 NotImplemented；Stream B 合入 puppeteer/CDP 逻辑。
 * 保留签名以便 P1-A (runtime-evidence) / P1-B (content-fingerprint) 导入即可写消费代码。
 */
export async function captureReferenceManifest(_input: {
  url: string
  viewport?: { width: number; height: number; deviceScaleFactor?: number }
  /** 产物落盘目录（manifest.json + screenshot.png + har.json）。 */
  outDir: string
}): Promise<CaptureManifestType> {
  throw new Error(
    "capture-gate: captureReferenceManifest not yet implemented — P0-A (Stream B) scope. " +
    "Stub exists only to lock the CaptureManifest schema for downstream consumers.",
  )
}
