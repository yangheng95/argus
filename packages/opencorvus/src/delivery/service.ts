/**
 * DeliveryService — orchestrator-facing delivery verification stage.
 *
 * 责任（从外到内的判决层级）：
 *   1. **Runtime-evidence 前置闸（P1-A）** — 先于 LLM 采集真 build 产物 + DOM 快照。
 *      缺 build / 空 root shell / DOM 过薄 ⇒ 直接合成 rejected verdict，不召唤 LLM。
 *   2. **LLM verdict（DeliveryAgent.verify）** — 只有 runtime-evidence 通过才跑。
 *   3. **视觉硬门（P0-B）** — 复用 runtime-evidence 同轮产出的 rendered.png，
 *      避免双重渲染（rule 22）；任一硬门 fail ⇒ finalizeVerdict 把 accepted 翻为 rejected。
 *
 * 所有意外升级为 DeliveryFailureError 让上游区分类型处理。
 */
import path from "node:path"
import { DeliveryAgent, type DeliveryVerdictType } from "./agent"
import type { GoalInfo, DeliveryInfo } from "./checks"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { AttachmentStore } from "@/storage/attachment-store"
import {
  computeVisualMetric,
  loadVisualThresholds,
  summarizeVisualMetric,
  type VisualMetricResult,
} from "./visual-metric"
import { finalizeVerdict, synthesizeRuntimeRejection } from "./verdict"
import {
  computeRuntimeEvidence,
  summarizeRuntimeViolations,
  type RuntimeEvidenceReport,
} from "./checks/runtime-evidence"

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
    /** Parent session for the delivery child session. Post-phase-3-b the
     *  delivery agent creates its own child session; this is only an
     *  optional parent pointer. */
    parentSessionID?: string
  }): Promise<DeliveryVerdictType> {
    log.info("delivery service verify starting", {
      title: input.task.title,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
    })

    const referencePath = resolveReferenceAttachmentPath(input.attachments)
    const goalIds = input.goals.map((g) => g.id)

    // 1. Runtime-evidence 前置闸（P1-A）
    let runtimeReport: RuntimeEvidenceReport | undefined
    if (referencePath) {
      try {
        runtimeReport = await computeRuntimeEvidence({
          projectDir: Filesystem.resolve(Instance.directory),
          outDir: path.join(
            Filesystem.resolve(Instance.directory),
            ".opencorvus",
            "delivery-hard-gate",
            input.task.id ?? "no-task",
          ),
          referenceForViewport: referencePath,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.error("runtime-evidence raised", { title: input.task.title, error: msg })
        throw new DeliveryFailureError(`runtime-evidence crashed: ${msg}`, { cause: err })
      }
      if (!runtimeReport.passed) {
        log.warn("runtime-evidence gate rejected delivery", {
          title: input.task.title,
          violations: summarizeRuntimeViolations(runtimeReport.violations),
        })
        return synthesizeRuntimeRejection(runtimeReport, goalIds)
      }
      log.info("runtime-evidence gate passed", {
        title: input.task.title,
        domTextLength: runtimeReport.evidence.dom?.textLength,
        domNodeCount: runtimeReport.evidence.dom?.nodeCount,
      })
    }

    // 2. LLM verdict
    let llmVerdict: DeliveryVerdictType
    try {
      llmVerdict = await DeliveryAgent.verify({
        task: input.task,
        goals: input.goals,
        delivery: input.delivery,
        attachments: input.attachments,
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

    // 3. P0-B 视觉硬门——复用 runtime-evidence 的 rendered.png
    let finalVerdict = llmVerdict
    try {
      const metric = await runVisualHardGate({
        referencePath,
        preRenderedPath: runtimeReport?.evidence.renderedPngPath,
      })
      if (metric) {
        log.info("delivery visual hard gate", {
          title: input.task.title,
          summary: summarizeVisualMetric(metric),
          passed: metric.passed,
          score: metric.score,
        })
        finalVerdict = finalizeVerdict(llmVerdict, metric, goalIds)
      }
    } catch (err) {
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
 * 复用 runtime-evidence 已经渲染好的 PNG 跑硬门。reference 缺失 ⇒ 非视觉任务，
 * gate 不适用（返 null）；runtime-evidence 已产出 rendered 但缺失时属于调用方
 * 编排 bug（runtime-evidence 应先于此跑），直接异常。
 */
async function runVisualHardGate(input: {
  referencePath: string | undefined
  preRenderedPath: string | undefined
}): Promise<VisualMetricResult | null> {
  if (!input.referencePath) return null
  if (!input.preRenderedPath) {
    throw new Error(
      "visual hard gate: reference present but runtime-evidence did not provide a rendered PNG — " +
        "this indicates runtime-evidence was skipped or reported non-visual task with a reference attachment. Bug.",
    )
  }
  const thresholds = loadVisualThresholds()
  return await computeVisualMetric({
    renderedPath: input.preRenderedPath,
    referencePath: input.referencePath,
    thresholds,
    // chartRegion / referenceStrings / renderedText 由 P1-B (Stream F) 的
    // CaptureManifest 提供；在此前 text_hit_ratio gate 自动 skip。
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
