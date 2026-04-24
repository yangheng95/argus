/**
 * P0-0 · Delivery tool 多模态返回契约（stub，先于 Stream A 合入）。
 *
 * 背景（spec delivery-quality-gate.md §P0-0）：现状 `screenshot` /
 * `verify_page_integrity` 只返回 `path` + 数字，LLM 需显式再调 read_file 才能
 * 把图拉进下一轮 multimodal context —— 事故证明从未触发，LLM 26 轮都"只看数字
 * 不看图"。Stream A 的核心动作就是把这两个 tool 的 execute 返回值改为携带
 * PNG（作为 attachment），本文件提供 A 与 C 共用的类型 + builder，避免双方各
 * 写一份产生双源（rule 22）。
 *
 * 和 session/message.ts::toModelOutput 的既有约定对齐：
 *    tool.execute() 返回 { text, attachments: [{ type: "file", mime, url: "data:..;base64,..", filename? }] }
 *    session loop 会把 attachments 拆进 UIMessage content 作为 media parts。
 * 参考实现：src/design-analyst/url-screenshot-tool.ts。
 *
 * 契约要点（Stream A 必须遵守）：
 *  - 失败路径不得降级为"只返回文本描述"（rule 1）——要么返回 multimodal 含图，
 *    要么抛错让 submit_verdict 拒收；禁止静默返回不含图的 text-only 结构。
 *  - data URL 必须是当轮 puppeteer 新渲染的 PNG，禁止复用 prior-run cache。
 */
import fs from "node:fs/promises"
import path from "node:path"

/** 单个附件；与 session/message.ts::toModelOutput 的 attachment schema 对齐。 */
export interface DeliveryToolAttachment {
  type: "file"
  mime: string
  /** 必须是 data:<mime>;base64,<payload>，file:// 与 http 路径均不被 toModelOutput 采纳。 */
  url: string
  filename?: string
}

/**
 * Delivery 多模态 tool 返回值。
 * text 字段承载结构化 JSON / 摘要；attachments 承载 PNG。
 * 任一工具调用要把"视觉证据"送进 LLM 的**当轮**输入，就必须用这个形状返回。
 */
export interface DeliveryMultimodalToolOutput {
  text: string
  attachments: DeliveryToolAttachment[]
}

/** PNG 文件转 data URL 的统一入口；集中在此便于测试桩替换。 */
export async function imagePathToDataUrl(absPath: string, mime: string = "image/png"): Promise<string> {
  const buf = await fs.readFile(absPath)
  return `data:${mime};base64,${buf.toString("base64")}`
}

/** 默认根据后缀名推断 mime；不认识的后缀一律抛错，禁猜（rule 1）。 */
function mimeFromExt(absPath: string): string {
  const ext = path.extname(absPath).toLowerCase()
  if (ext === ".png") return "image/png"
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  throw new Error(`tool-result: unsupported image extension ${ext} (path=${absPath})`)
}

/**
 * Builder —— 所有 delivery tool 都应走这个入口产生返回值，保证 data URL 与
 * filename 的拼装不在每个 tool 里各写一遍（rule 24：抽象出共用模式）。
 *
 * `text` 应当是结构化 JSON 字符串（现 screenshot/verify_page_integrity 已经是
 * 这个形状），保证 LLM 继续按字段读数值指标；images 则直接走 multimodal 通道。
 */
export async function buildMultimodalToolResult(input: {
  text: string
  images: Array<{
    path: string
    mime?: string
    filename?: string
  }>
}): Promise<DeliveryMultimodalToolOutput> {
  const attachments: DeliveryToolAttachment[] = []
  for (const img of input.images) {
    const mime = img.mime ?? mimeFromExt(img.path)
    const dataUrl = await imagePathToDataUrl(img.path, mime)
    attachments.push({
      type: "file",
      mime,
      url: dataUrl,
      filename: img.filename ?? path.basename(img.path),
    })
  }
  return { text: input.text, attachments }
}
