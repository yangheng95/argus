/**
 * Delivery tool 多模态返回契约（single source）。
 *
 * 背景（specs/delivery-attachment-store-single-source-2026-05-11.md）：
 *   原契约由 tool 直接返回 `data:<mime>;base64,...` 形式的 url，把整张 PNG
 *   的 base64 拼进 part.state.attachments[].url。一次 compare_visual_artifacts
 *   产出 600 KB 单 part，单 session 同一张图被复制 40 次（DB 实测），叠加
 *   Session.updatePart 写整列 + prompt 装配阶段 JSON.stringify → in-flight
 *   单 turn 内存抖几百 MB。
 *
 *   新契约（rule 8 单源）：tool execute 写盘（temp 或者已存在的 disk path），
 *   然后通过 `AttachmentStore.writeFromPath` 把字节交给内容寻址存储，返回的
 *   url 是 `/attachment/<projectID>/<sha>.<ext>` ref。后续轮次 toModelOutput
 *   识别这种 ref 并按需读盘 + base64 inline 给 AI SDK。base64 字节再也不
 *   落进 part.data。
 *
 * 失败路径（rule 1）：写 AttachmentStore 失败必须抛错，禁止静默 fallback
 * 成"只返回文本"或"返回 data URL"。
 */
import path from "node:path"
import { AttachmentStore } from "@/storage/attachment-store"

/** 单个附件。url 是 canonical `/attachment/<projectID>/<sha>.<ext>` ref —
 *  与 task attachments 共用同一种字符串形态（rule 8 单源），任何下游
 *  消费者都通过 `AttachmentStore.nameFromUrl` 解析；sha 也可直接从 url
 *  里取出来（避免把字段塞进 FilePart schema 又被 strip 掉）。 */
export interface DeliveryToolAttachment {
  type: "file"
  mime: string
  /** Canonical `/attachment/<projectID>/<sha>.<ext>` ref. Never `data:` —
   *  the Session.updatePart guard rejects inline base64 at the write
   *  boundary. */
  url: string
  filename?: string
}

/**
 * Delivery 多模态 tool 返回值。
 * text 字段承载结构化 JSON / 摘要；attachments 承载 PNG ref。
 */
export interface DeliveryMultimodalToolOutput {
  text: string
  attachments: DeliveryToolAttachment[]
}

/**
 * Builder —— 所有 delivery tool 都应走这个入口产生返回值，保证图像 ref
 * 的拼装不在每个 tool 里各写一遍（rule 24：抽象出共用模式）。
 *
 * - 每张图通过 `AttachmentStore.writeFromPath` 写入内容寻址存储。
 *   同一字节序列写入多次自动去重（同一 sha 命名的 file 已存在则 skip）。
 * - 返回值里的 url 是 `/attachment/<projectID>/<sha>.<ext>`，不是 data URL。
 *   后续 toModelOutput 在装配 ModelMessage 时按 ref 读盘 + base64 inline。
 *
 * MIME 推断：若调用方未指定，则从 path 扩展名推断（见 AttachmentStore.writeFromPath）。
 * 不认识的扩展名一律抛错（rule 1）。
 */
export async function buildMultimodalToolResult(input: {
  projectID: string
  text: string
  images: Array<{
    path: string
    mime?: string
    filename?: string
  }>
}): Promise<DeliveryMultimodalToolOutput> {
  const attachments: DeliveryToolAttachment[] = []
  for (const img of input.images) {
    const filename = img.filename ?? path.basename(img.path)
    const ref = await AttachmentStore.writeFromPath(input.projectID, img.path, img.mime, filename)
    attachments.push({
      type: "file",
      mime: ref.mime,
      url: ref.url,
      filename,
    })
  }
  return { text: input.text, attachments }
}
