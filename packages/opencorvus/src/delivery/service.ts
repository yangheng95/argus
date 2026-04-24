/**
 * DeliveryService — orchestrator-facing delivery verification stage.
 *
 * 责任：
 *   - 包装 DeliveryAgent.verify（LLM 判决）
 *   - LLM 出 verdict 后跑 P0-B 数值硬门（见 visual-metric.ts），任一硬门 fail
 *     ⇒ finalizeVerdict 把 accepted 翻为 rejected。LLM 无权推翻。
 *   - 抛出 DeliveryFailureError 包装失败，让上游按类型识别。
 *
 * 抽象边界：gate 的 rendered.png 渲染由 Stream A (P0-0) 的
 * orchestrator/tools.ts:deliver() 在 delivery 开始前产出并通过 attachments 传入
 * （intent="rendered_output"）。Stream A 尚未 merge 时，此 service 会尝试用
 * 既有的 findRenderedIndex + renderPage 作为 best-effort 兜底以触发 gate；
 * 未来 A 合入后会切到 attachment-only 路径（见 TODO 标记）。
 *
 * Abort-signal composition and stream-failure collection are owned by
 * AgentRuntime (which DeliveryAgent dispatches through).
 */
import path from "node:path"
import { DeliveryAgent, type DeliveryVerdictType } from "./agent"
import type { GoalInfo, DeliveryInfo } from "./checks"
import { Log } from "@/util/log"
import { type TextHooks } from "@/llm/api"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { AttachmentStore } from "@/storage/attachment-store"
import {
  computeVisualMetric,
  loadVisualThresholds,
  summarizeVisualMetric,
  type VisualMetricResult,
} from "./visual-metric"
import { finalizeVerdict } from "./verdict"
import { findRenderedIndex, renderPage } from "./checks/visual"

const log = Log.create({ service: "delivery-service" })

export class DeliveryFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "DeliveryFailureError"
  }
}

type AttachmentLike = {
  sha: string
  url: string
  mime: string
  size: number
  filename?: string
  intent?: string
  source?: string
}

export namespace DeliveryService {
  export async function verify(input: {
    task: { id?: string; title: string; request: string; sessionID?: string; metadata?: Record<string, unknown>; design_specs?: Array<{ id: string; category: string; title: string; requirement: string; applies_to: string; severity: "must" | "should"; rationale?: string }> }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    attachments?: AttachmentLike[]
    signal?: AbortSignal
    stream?: TextHooks
  }): Promise<DeliveryVerdictType> {
    log.info("delivery service verify starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
    })

    let llmVerdict: DeliveryVerdictType
    try {
      llmVerdict = await DeliveryAgent.verify({
        task: input.task,
        goals: input.goals,
        delivery: input.delivery,
        attachments: input.attachments,
        stream: input.stream,
        signal: input.signal,
      })
    } catch (error) {
      log.error("delivery service verify failed", {
        title: input.task.title,
        error: String(error),
        cause: error instanceof Error && "cause" in error ? String(error.cause) : undefined,
      })
      if (error instanceof DeliveryFailureError) throw error
      throw new DeliveryFailureError("delivery agent failed", { cause: error })
    }

    // P0-B 硬门：LLM verdict 之后再跑数值指标。gate 失败可以把 accepted 翻为 rejected。
    let finalVerdict = llmVerdict
    try {
      const metric = await runVisualHardGate(input.attachments, input.task.id)
      if (metric) {
        log.info("delivery visual hard gate", {
          title: input.task.title,
          summary: summarizeVisualMetric(metric),
          passed: metric.passed,
          score: metric.score,
        })
        finalVerdict = finalizeVerdict(
          llmVerdict,
          metric,
          input.goals.map((g) => g.id),
        )
      }
    } catch (err) {
      // Gate 本身崩溃（PNG 解码失败、puppeteer 异常等）绝不降级为 "gate 跳过" 从而
      // 放行 accepted——按 rule 1/12 直接升格为 DeliveryFailureError，让上游走重试/
      // 拒收路径，不掩盖问题。
      const msg = err instanceof Error ? err.message : String(err)
      log.error("delivery visual hard gate raised", {
        title: input.task.title,
        error: msg,
      })
      throw new DeliveryFailureError(`visual hard gate crashed: ${msg}`, { cause: err })
    }

    log.info("delivery service verify completed", {
      title: input.task.title,
      llmVerdict: llmVerdict.verdict,
      finalVerdict: finalVerdict.verdict,
      overridden: llmVerdict.verdict !== finalVerdict.verdict,
      issuesFound: finalVerdict.issues_found.length,
      startupSuccess: finalVerdict.startup_verification.success,
    })
    return finalVerdict
  }
}

/**
 * 解析 reference + rendered 两路 PNG，若齐备则跑 P0-B 硬门。
 * 返回 null 表示 gate 不适用（非视觉任务：无 reference 附件）。
 * 其他任何异常直接向外抛——调用方决定如何把失败升级为 DeliveryFailureError。
 */
async function runVisualHardGate(
  attachments: AttachmentLike[] | undefined,
  taskId: string | undefined,
): Promise<VisualMetricResult | null> {
  const referencePath = resolveReferenceAttachmentPath(attachments)
  if (!referencePath) {
    return null // 非视觉任务，gate 不适用
  }

  const renderedPath = await resolveRenderedPath(referencePath, taskId)
  if (!renderedPath) {
    // 有 reference 却拿不到 rendered：这是 Stream A (P0-0) 未就位的信号。
    // 不伪造 gate 结果、不降级——直接把缺失升级为异常，由 caller 包成
    // DeliveryFailureError。符合 rule 1（禁 fallback）与 rule 12。
    throw new Error(
      "visual hard gate: reference attachment present but rendered artifact unavailable. " +
      "Stream A (P0-0) must ensure rendered_output is produced before delivery verdict.",
    )
  }

  const thresholds = loadVisualThresholds()
  return await computeVisualMetric({
    renderedPath,
    referencePath,
    thresholds,
    // chartRegion / referenceStrings / renderedText 由 P1-B (Stream F) 在
    // CaptureManifest 里提供，届时通过 attachments 或 task.metadata 传入；
    // 目前 text_hit_ratio 硬门会自动 skip（其余 4 条仍生效）。
  })
}

function resolveReferenceAttachmentPath(
  attachments: AttachmentLike[] | undefined,
): string | undefined {
  if (!attachments || attachments.length === 0) return undefined
  const ref = attachments.find(
    (a) => a.intent === "visual_reference" && a.mime.startsWith("image/"),
  )
  if (!ref) return undefined
  const located = AttachmentStore.nameFromUrl(ref.url)
  if (!located) return undefined
  return AttachmentStore.resolveAbsolute(located.projectID, located.name)
}

/**
 * Rendered PNG 单一来源：每次硬门判决都现场对当前 project dir 的 dist 重新渲染。
 *
 * 理由：硬门是对"当前 merged state"的判定，不应复用 LLM 中途拍的过时截图，
 * 也不应与 Stream A 的 rendered_output attachment 形成双源（rule 22）。
 * Stream A 的 rendered_output 负责喂 LLM 视觉上下文；本硬门自行渲染，两件事
 * 职责分离、不共享数据路径，但都以 puppeteer `renderPage` 为底层单例。
 *
 * 找不到 build 产物（findRenderedIndex 返 undefined）即返回 undefined，由
 * 调用方升级为硬失败——有视觉 reference 却无渲染产物本就是交付失败状态。
 */
async function resolveRenderedPath(
  referencePath: string,
  taskId: string | undefined,
): Promise<string | undefined> {
  const projectDir = Filesystem.resolve(Instance.directory)
  const indexHtml = await findRenderedIndex(projectDir)
  if (!indexHtml) return undefined

  const outDir = path.join(
    projectDir,
    ".opencorvus",
    "delivery-hard-gate",
    taskId ?? "no-task",
  )
  const result = await renderPage({
    rendered: indexHtml,
    outDir,
    referenceForViewport: referencePath,
  })
  return result.renderedPath
}
